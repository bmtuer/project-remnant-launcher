import { app, BrowserWindow, Tray, Menu, ipcMain, nativeImage, shell } from 'electron';
import { join } from 'path';
import { readTokens, writeTokens, clearTokens } from './tokenStore.js';

let mainWindow = null;
let tray = null;
let quitting = false;

const WIN_BASELINE_WIDTH = 960;
const WIN_BASELINE_HEIGHT = 640;
const WIN_MIN_WIDTH = 800;
const WIN_MIN_HEIGHT = 600;
const WIN_MAX_WIDTH = 1280;
const WIN_MAX_HEIGHT = 800;

function createMainWindow() {
  mainWindow = new BrowserWindow({
    width: WIN_BASELINE_WIDTH,
    height: WIN_BASELINE_HEIGHT,
    minWidth: WIN_MIN_WIDTH,
    minHeight: WIN_MIN_HEIGHT,
    maxWidth: WIN_MAX_WIDTH,
    maxHeight: WIN_MAX_HEIGHT,
    resizable: true,
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

  // Close-X minimizes to tray; only tray "Quit" or app.quit() truly exits.
  mainWindow.on('close', (event) => {
    if (!quitting) {
      event.preventDefault();
      mainWindow.hide();
    }
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
        app.quit();
      },
    },
  ]);
  tray.setContextMenu(menu);
  tray.on('click', () => showMainWindow());
}

function registerIpc() {
  ipcMain.handle('app:getVersion', () => app.getVersion());
  ipcMain.on('window:hide', () => mainWindow?.hide());
  ipcMain.on('app:quit', () => {
    quitting = true;
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
}

app.whenReady().then(() => {
  registerIpc();
  createMainWindow();
  createTray();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createMainWindow();
    else showMainWindow();
  });
});

app.on('window-all-closed', (event) => {
  // Don't quit when all windows close — launcher lives in the tray.
  event.preventDefault?.();
});

app.on('before-quit', () => {
  quitting = true;
});
