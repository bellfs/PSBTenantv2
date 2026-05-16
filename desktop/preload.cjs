const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('ffrDesktop', {
  isDesktop: true,
  platform: process.platform,
  notify: (payload) => ipcRenderer.invoke('desktop:notify', payload),
  openExternal: (url) => ipcRenderer.invoke('desktop:open-external', url)
});
