const { contextBridge, ipcRenderer } = require('electron');
const api = {};
for (const name of ['listPlatforms','runtimeInfo','selectMedia','attachMedia','fillPlatform','probeOptions','openAll','openPlatform','reloadPlatform','focusPlatform','publish','showLogs','resetLogins','exportDiagnostics','restoreMedia']) api[name] = (...args) => ipcRenderer.invoke('fixture:call', name, args);
api.onStates = () => {};
contextBridge.exposeInMainWorld('blockcast', api);
