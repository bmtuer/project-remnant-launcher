// Launcher self-updater. Wraps electron-updater (autoUpdater) with
// the launcher's specific lifecycle:
//
//   1. On app.whenReady, check for updates against
//      bmtuer/project-remnant-launcher-releases (the public-only
//      releases repo for the launcher binary).
//   2. If update available → download in background.
//   3. When download completes → send `launcher:update-ready` to the
//      renderer. The renderer surfaces a banner with "Restart &
//      Install" / "Later" buttons.
//   4. On Restart & Install: app exits, electron-updater applies
//      the new binary, launcher relaunches at the new version.
//
// Differential updates: electron-builder generates a `latest.yml`
// manifest + `.blockmap` files alongside the .exe. electron-updater
// downloads only the changed blocks, so v0.1.0 → v0.1.1 transfers
// ~tens of MB instead of the full ~80MB binary. This is the same
// mechanism the game updater will use in PR 5.
//
// In dev (electron-vite dev), there's no packaged binary, so
// autoUpdater can't do anything — guard the entire module behind
// the production check and no-op silently.

import { autoUpdater } from 'electron-updater';

let mainWindowRef = null;

const isDev = !!process.env.ELECTRON_RENDERER_URL;

/**
 * Wire the launcher's self-updater. Call once from main/index.js
 * after the main window exists. Forwards update events to the
 * renderer via `launcher:update-*` IPC messages.
 *
 * @param {BrowserWindow} mainWindow
 */
export function startLauncherUpdater(mainWindow) {
  if (isDev) {
    // In dev, electron-updater would error trying to read a
    // non-existent app-update.yml. Skip the entire wire.
    return;
  }
  mainWindowRef = mainWindow;

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = false; // we control the restart

  autoUpdater.on('checking-for-update', () => emit('checking'));
  autoUpdater.on('update-available',     (info) => emit('available', { version: info?.version }));
  autoUpdater.on('update-not-available', () => emit('up-to-date'));
  autoUpdater.on('download-progress',    (p) => emit('progress', { percent: p?.percent ?? 0, bps: p?.bytesPerSecond ?? 0 }));
  autoUpdater.on('update-downloaded',    (info) => emit('ready', { version: info?.version }));
  autoUpdater.on('error', (err) => {
    // Updater errors are non-fatal — the launcher still works at the
    // current version. Surface to renderer for visibility but don't
    // block.
    emit('error', { message: err?.message ?? 'Updater error' });
  });

  // Kick off the check. Async; events flow as the check + download
  // progresses.
  autoUpdater.checkForUpdates().catch((err) => {
    // Common case here: GitHub returned 404 (no releases yet on
    // project-remnant-launcher-releases). That's expected pre-first-
    // publish; treat as up-to-date.
    emit('up-to-date');
    // Don't throw — the launcher should keep working without the
    // updater succeeding.
  });
}

/**
 * Trigger restart + install. Called from the renderer in response to
 * the player clicking "Restart & Install" on the update banner.
 */
export function quitAndInstallLauncher() {
  if (isDev) return;
  // setImmediate gives the renderer a tick to acknowledge before the
  // process exits — keeps the UI from showing a frozen "Restarting…"
  // banner.
  setImmediate(() => {
    autoUpdater.quitAndInstall();
  });
}

function emit(status, payload = {}) {
  if (!mainWindowRef || mainWindowRef.isDestroyed()) return;
  mainWindowRef.webContents.send('launcher:update-status', { status, ...payload });
}
