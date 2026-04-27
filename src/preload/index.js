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

  // Tray "Sign Out" menu item posts this; renderer responds by tearing
  // down the session via useAppStore.signOut.
  onSignOutRequested: (handler) => {
    const listener = () => handler();
    ipcRenderer.on('launcher:request-sign-out', listener);
    return () => ipcRenderer.removeListener('launcher:request-sign-out', listener);
  },
});
