import { app, BrowserWindow, Tray, Menu, ipcMain, nativeImage, shell } from 'electron';
import { join } from 'path';
import { readTokens, writeTokens, clearTokens } from './tokenStore.js';
import {
  spawnGame,
  isGameRunning,
  killGame,
  hideLauncherWindows,
  showLauncherWindows,
} from './gameSpawner.js';
import { startIpcServer, stopIpcServer, getPipePath } from './ipcServer.js';
import { startLauncherUpdater, quitAndInstallLauncher } from './launcherUpdater.js';
import { readSettings, writeSettings, peekSettings, syncAutoLaunch } from './settingsStore.js';

// ─── Single-instance lock ─────────────────────────────────────────────
// Required for the `remnant://` protocol handoff. When the game spawns
// without a JWT (player double-clicked the .exe directly), it calls
// shell.openExternal('remnant://launch'). Windows finds the launcher
// binary registered for that scheme and either:
//   1. Starts a new launcher process (if none running) — main window
//      opens normally.
//   2. Sends a 'second-instance' event to the existing launcher process
//      — we restore the window from tray + bring to front.
// Without this lock, both cases could end up with two launchers running.
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  // Another launcher is already running. Quit silently — the existing
  // launcher will receive our argv via second-instance and route any
  // remnant:// URL itself.
  app.quit();
}

// Register the launcher as the OS-level handler for `remnant://`. In
// dev mode, Windows wants the path to electron.exe + the project
// directory; in packaged builds, electron-builder's NSIS install adds
// a registry entry that takes precedence over this call.
if (process.defaultApp) {
  if (process.argv.length >= 2) {
    app.setAsDefaultProtocolClient('remnant', process.execPath, [
      join(__dirname, '..', '..'),
    ]);
  }
} else {
  app.setAsDefaultProtocolClient('remnant');
}

let mainWindow = null;
let tray = null;
let quitting = false;

// Three discrete window-size presets. Player picks one in Settings
// and the launcher remembers across launches. Bounds line up with the
// rem-scaler in App.jsx (which references 960×640 as the baseline) —
// at any of the three sizes, content scales proportionally so the
// layout reads correctly without per-size CSS.
const WINDOW_SIZE_PRESETS = Object.freeze({
  compact:  { width: 960,  height: 640 },
  standard: { width: 1120, height: 720 },
  large:    { width: 1280, height: 800 },
});
const DEFAULT_WINDOW_SIZE = 'standard';

function getPresetDimensions(name) {
  return WINDOW_SIZE_PRESETS[name] ?? WINDOW_SIZE_PRESETS[DEFAULT_WINDOW_SIZE];
}

function createMainWindow() {
  // Read the player's chosen preset from cached settings (already
  // hydrated in app.whenReady before window creation).
  const { width, height } = getPresetDimensions(peekSettings().windowSize);

  mainWindow = new BrowserWindow({
    width,
    height,
    // Non-resizable: dropdown is the only path to a different size.
    // Avoids the "I dragged it bigger but the dropdown still says
    // Compact" confusion. Player picks a preset, launcher snaps to it.
    resizable: false,
    fullscreenable: false,
    maximizable: false,
    autoHideMenuBar: true,
    backgroundColor: '#0a070e',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  mainWindow.setMenu(null);

  // Close-X behavior is configurable via Settings. Default is 'tray'
  // (close minimizes to tray, like Battle.net / Riot). Players who
  // prefer the close-button to actually quit can flip this in Settings.
  mainWindow.on('close', (event) => {
    if (quitting) return;
    const settings = peekSettings();
    if (settings.closeXBehavior === 'quit') {
      // User opted into quit-on-close. Mirror the tray "Quit" path.
      quitting = true;
      if (isGameRunning()) killGame();
      app.quit();
      return;
    }
    event.preventDefault();
    mainWindow.hide();
  });

  if (process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'));
  }
}

function showMainWindow() {
  if (!mainWindow) {
    createMainWindow();
    return;
  }
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

function createTray() {
  // Placeholder icon — final art deferred. nativeImage.createEmpty() yields
  // a generic Windows tray slot; replace with `build/icons/tray.ico` at art-pass.
  const icon = nativeImage.createEmpty();
  tray = new Tray(icon);
  tray.setToolTip('Remnant Launcher');

  const menu = Menu.buildFromTemplate([
    { label: 'Open Launcher', click: () => showMainWindow() },
    { type: 'separator' },
    {
      label: 'Sign Out',
      click: () => {
        showMainWindow();
        mainWindow?.webContents.send('launcher:request-sign-out');
      },
    },
    { type: 'separator' },
    {
      label: 'Quit',
      click: () => {
        quitting = true;
        if (isGameRunning()) killGame();
        app.quit();
      },
    },
  ]);
  tray.setContextMenu(menu);
  tray.on('click', () => showMainWindow());
}

// ─── Token-refresh handler (IPC server consumer) ──────────────────────
// When the game's JWT nears expiry, it sends `refresh-token` over the
// named pipe. We read the latest tokens from safeStorage, ask the
// renderer to rotate them via Supabase Auth, and respond with the new
// access_token. Game updates its Authorization header on next request.
//
// PR 2 part 2 ships the IPC plumbing; the actual rotation is a
// renderer-mediated round-trip because Supabase JS lives in the
// renderer (only place that has the singleton client). The renderer
// exposes a `tokens:refresh` IPC handler we invoke from main.
async function handleTokenRefresh() {
  // Round-trip via the renderer: it owns the supabase client; main
  // owns persistent storage. Renderer hits supabase.auth.refreshSession,
  // returns the new bundle, and main re-persists.
  const win = mainWindow;
  if (!win || win.isDestroyed()) {
    throw new Error('No renderer available for token refresh.');
  }
  // executeJavaScript-free path: send an IPC, await response. The
  // renderer registers a one-shot handler for this each time.
  const fresh = await win.webContents.executeJavaScript(
    `window.__refreshTokens && window.__refreshTokens()`,
    true,
  );
  if (!fresh?.access_token) {
    throw new Error('Refresh did not return a new access_token.');
  }
  await writeTokens(fresh);
  return { access_token: fresh.access_token, expires_at: fresh.expires_at };
}

function registerIpc() {
  ipcMain.handle('app:getVersion', () => app.getVersion());
  ipcMain.on('window:hide', () => mainWindow?.hide());
  ipcMain.on('app:quit', () => {
    quitting = true;
    if (isGameRunning()) killGame();
    app.quit();
  });

  ipcMain.handle('shell:openExternal', async (_e, url) => {
    // Allowlist by origin — only open URLs we vended (project-remnant.com,
    // staging vercel preview origins). Defense against a compromised
    // renderer trying to launch arbitrary URLs.
    try {
      const parsed = new URL(url);
      const ok =
        parsed.protocol === 'https:' &&
        (
          parsed.hostname === 'project-remnant.com' ||
          parsed.hostname.endsWith('.project-remnant.com') ||
          parsed.hostname === 'project-remnant-site.vercel.app' ||
          parsed.hostname.endsWith('.vercel.app')
        );
      if (!ok) return false;
      await shell.openExternal(url);
      return true;
    } catch {
      return false;
    }
  });

  ipcMain.handle('tokens:get',   ()       => readTokens());
  ipcMain.handle('tokens:set',   (_e, t)  => writeTokens(t));
  ipcMain.handle('tokens:clear', ()       => clearTokens());

  // ─── Game-spawn IPC ───────────────────────────────────────────────
  // Renderer requests game launch with the current session bundle.
  // Main hides the launcher window, spawns the game with stdin
  // handoff, and dispatches on exit-code when the game exits.
  ipcMain.handle('game:spawn', async (_e, bundle) => {
    if (isGameRunning()) {
      return { ok: false, error: 'already-running' };
    }
    return new Promise((resolve) => {
      const child = spawnGame(bundle, {
        onSpawnError: (err) => {
          // Surface the spawn error back to the renderer (toast it).
          mainWindow?.webContents.send('game:spawn-error', {
            code: err.code ?? 'UNKNOWN',
            message: err.message,
          });
          resolve({ ok: false, error: err.code ?? 'spawn-failed' });
        },
        onExit: (code) => {
          // Game exited. Restore launcher window + dispatch on the
          // exit code so the renderer can route to the right state
          // (re-sign-in for code 3, version-update flow for code 2,
          // etc.). PR 5 wires the version-update flow; PR 2 just
          // dispatches the code and the renderer toasts it for now.
          showLauncherWindows();
          mainWindow?.webContents.send('game:exited', { code });
        },
      });
      if (child) {
        // Spawn succeeded — hide launcher windows. Game is now running.
        hideLauncherWindows();
        resolve({ ok: true });
      }
      // If child is null, spawnGame already called onSpawnError +
      // resolve; nothing to do here.
    });
  });

  ipcMain.handle('game:isRunning', () => isGameRunning());

  // ─── Launcher self-update IPC ─────────────────────────────────────
  // Renderer subscribes to `launcher:update-status` events emitted by
  // launcherUpdater.js (status: checking / available / progress / ready
  // / up-to-date / error). When the player clicks "Restart & Install"
  // on the update banner, the renderer invokes this handler — main
  // calls autoUpdater.quitAndInstall on the next tick.
  ipcMain.handle('launcher:quitAndInstall', () => {
    quitAndInstallLauncher();
  });

  // ─── Settings IPC ─────────────────────────────────────────────────
  // Persistent settings (autoLaunchOnStartup / closeXBehavior /
  // defaultRealm / windowSize). Lives in userData; survives launcher
  // self-updates.
  //
  // windowSize is the only setting with a side-effect we need to
  // apply mid-session (the others either auto-sync via settingsStore
  // or take effect on the next event). When the renderer changes the
  // dropdown, we resize the window live to match — re-centering on
  // the current display so the new size doesn't drift to a corner.
  ipcMain.handle('settings:get', () => readSettings());
  ipcMain.handle('settings:set', async (_e, patch) => {
    const next = await writeSettings(patch ?? {});
    if (patch?.windowSize && mainWindow && !mainWindow.isDestroyed()) {
      const { width, height } = getPresetDimensions(next.windowSize);
      // setBounds allows changing size on a non-resizable window.
      // Center on the display the launcher's currently on so the
      // resize feels intentional rather than warping to a corner.
      const { screen } = require('electron');
      const display = screen.getDisplayMatching(mainWindow.getBounds());
      const { workArea } = display;
      const x = Math.round(workArea.x + (workArea.width  - width)  / 2);
      const y = Math.round(workArea.y + (workArea.height - height) / 2);
      mainWindow.setBounds({ x, y, width, height });
    }
    return next;
  });
}

// Track URLs we received via second-instance / open-url BEFORE the
// renderer was ready. We replay them once the main window mounts.
const pendingProtocolUrls = [];

function handleProtocolUrl(url) {
  if (!url || !url.startsWith('remnant://')) return;
  // Verbs: launch (default — bring launcher to front).
  // Future: realm/<id>, patch-notes, etc.
  if (mainWindow && !mainWindow.isDestroyed()) {
    showMainWindow();
  } else {
    pendingProtocolUrls.push(url);
  }
}

app.on('second-instance', (_event, argv) => {
  // A second launcher instance tried to start; we already exited that
  // process via the single-instance lock. Bring our window to front +
  // route any remnant:// URL the second instance was passed.
  const url = argv.find((a) => a.startsWith('remnant://'));
  if (url) {
    handleProtocolUrl(url);
  } else {
    showMainWindow();
  }
});

app.on('open-url', (event, url) => {
  // macOS path. Windows uses second-instance + argv.
  event.preventDefault();
  handleProtocolUrl(url);
});

app.whenReady().then(async () => {
  // Drain any startup-time protocol URLs (Windows passes them via argv
  // to the first-instance process before Electron is ready).
  const startupUrl = process.argv.find((a) => a.startsWith('remnant://'));
  if (startupUrl) pendingProtocolUrls.push(startupUrl);

  registerIpc();

  // Hydrate persistent settings before any window/tray work — populates
  // the in-memory cache so peekSettings() returns real values during
  // close-event handling. Also re-syncs the auto-launch flag with
  // Windows' login-items registry; covers the case where the user
  // toggled it on, then uninstalled-and-reinstalled the launcher
  // somewhere else, leaving the OS registration stale.
  const settings = await readSettings();
  syncAutoLaunch(settings.autoLaunchOnStartup);

  createMainWindow();
  createTray();

  // Launcher self-updater. Checks bmtuer/project-remnant-launcher-releases
  // for newer versions, downloads in background, emits
  // `launcher:update-status` events the renderer subscribes to. Pre-auth
  // banner surfaces when an update is ready so a stale launcher can't
  // sign in to a server with a bumped MIN_REQUIRED_LAUNCHER_VERSION.
  // Skipped in dev (no packaged binary to update against).
  startLauncherUpdater(mainWindow);

  // IPC server for the spawned game's runtime requests (token refresh).
  // Pipe path is PID-scoped — the spawned game inherits our PID
  // through stdin's bundle and reconnects post-spawn.
  startIpcServer({
    'refresh-token': () => handleTokenRefresh(),
  });

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
    else showMainWindow();
  });

  // Expose the IPC pipe path so the renderer can include it in the
  // spawn bundle (game uses it to reconnect for token refresh).
  ipcMain.handle('ipc:getPipePath', () => getPipePath());
});

app.on('window-all-closed', (event) => {
  // Don't quit when all windows close — launcher lives in the tray.
  event.preventDefault?.();
});

app.on('before-quit', () => {
  quitting = true;
  stopIpcServer();
  if (isGameRunning()) killGame();
});

