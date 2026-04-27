import { contextBridge, ipcRenderer } from 'electron';

contextBridge.exposeInMainWorld('launcher', {
  getVersion: () => ipcRenderer.invoke('app:getVersion'),
  hideWindow: () => ipcRenderer.send('window:hide'),
  quit: () => ipcRenderer.send('app:quit'),
  onSignOutRequested: (handler) => {
    const listener = () => handler();
    ipcRenderer.on('launcher:request-sign-out', listener);
    return () => ipcRenderer.removeListener('launcher:request-sign-out', listener);
  },
});
