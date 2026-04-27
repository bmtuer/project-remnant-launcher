import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('launcher', {
  getVersion: () => ipcRenderer.invoke('app:getVersion'),
  hideWindow: () => ipcRenderer.send('window:hide'),
  quit: () => ipcRenderer.send('app:quit'),

  // Open a URL in the default browser. Used for footer links to the public
  // site's account pages — sign-up, forgot-password.
  openExternal: (url) => ipcRenderer.invoke('shell:openExternal', url),

  // Encrypted token storage in main process (safeStorage + userData).
  tokens: {
    get:   () => ipcRenderer.invoke('tokens:get'),
    set:   (data) => ipcRenderer.invoke('tokens:set', data),
    clear: () => ipcRenderer.invoke('tokens:clear'),
  },

  // Game lifecycle. PR 2 wires spawn + exit-event subscription; PR 5
  // adds the version-gate sequence, the realm picker dropdown, and
  // the differential-update flow before spawn.
  game: {
    spawn:     (bundle) => ipcRenderer.invoke('game:spawn', bundle),
    isRunning: () => ipcRenderer.invoke('game:isRunning'),
    onExit:    (handler) => {
      const listener = (_e, payload) => handler(payload);
      ipcRenderer.on('game:exited', listener);
      return () => ipcRenderer.removeListener('game:exited', listener);
    },
    onSpawnError: (handler) => {
      const listener = (_e, payload) => handler(payload);
      ipcRenderer.on('game:spawn-error', listener);
      return () => ipcRenderer.removeListener('game:spawn-error', listener);
    },
  },

  // The named-pipe path used by the spawned game for runtime IPC
  // (token refresh). PID-scoped per main/ipcServer.js. Renderer
  // includes this in the spawn bundle so the game can reconnect
  // post-spawn.
  ipc: {
    getPipePath: () => ipcRenderer.invoke('ipc:getPipePath'),
  },

  // Launcher self-update lifecycle. Main emits `launcher:update-status`
  // events with shape { status, ...payload } where status is one of
  // `checking` / `available` / `progress` / `ready` / `up-to-date` /
  // `error`. Renderer subscribes via onUpdateStatus; clicks
  // quitAndInstall when the player consents to restart.
  updater: {
    onUpdateStatus: (handler) => {
      const listener = (_e, payload) => handler(payload);
      ipcRenderer.on('launcher:update-status', listener);
      return () => ipcRenderer.removeListener('launcher:update-status', listener);
    },
    quitAndInstall: () => ipcRenderer.invoke('launcher:quitAndInstall'),
  },

  // Persistent launcher settings (autoLaunchOnStartup, closeXBehavior,
  // defaultRealm). Stored in userData/settings.json — survives
  // launcher self-updates. Renderer reads on Settings open + writes
  // on each control change.
  settings: {
    get: () => ipcRenderer.invoke('settings:get'),
    set: (patch) => ipcRenderer.invoke('settings:set', patch),
  },

  // Tray "Sign Out" menu item posts this; renderer responds by tearing
  // down the session via useAppStore.signOut.
  onSignOutRequested: (handler) => {
    const listener = () => handler();
    ipcRenderer.on('launcher:request-sign-out', listener);
    return () => ipcRenderer.removeListener('launcher:request-sign-out', listener);
  },
});
