const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
    onWhatsAppUpdate: (callback) => ipcRenderer.on('whatsapp-update', (_event, value) => callback(value)),
    onStatsUpdate: (callback) => ipcRenderer.on('stats-update', (_event, value) => callback(value)),
    onNewLog: (callback) => ipcRenderer.on('new-log', (_event, value) => callback(value)),
    getConfig: () => ipcRenderer.invoke('get-config'),
    saveConfig: (config) => ipcRenderer.invoke('save-config', config)
});
