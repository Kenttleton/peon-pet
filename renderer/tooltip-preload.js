const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('tooltipBridge', {
  onShow: (callback) => ipcRenderer.on('tooltip-show', (_e, html) => callback(html)),
  reportSize: (size) => ipcRenderer.send('tooltip-size', size),
});
