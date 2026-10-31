const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('blockcast', {
  listPlatforms: () => ipcRenderer.invoke('platform:list'),
  openPlatform: id => ipcRenderer.invoke('platform:open', id),
  openAll: () => ipcRenderer.invoke('platform:open-all'),
  focusPlatform: id => ipcRenderer.invoke('platform:focus', id),
  reloadPlatform: id => ipcRenderer.invoke('platform:reload', id),
  probeOptions: id => ipcRenderer.invoke('platform:probe-options', id),
  reviewAll: () => ipcRenderer.invoke('platform:review-all'),
  selectMedia: kind => ipcRenderer.invoke('media:select', kind),
  resolveDroppedMedia: (file, kind) => ipcRenderer.invoke('media:from-path', { filePath: webUtils.getPathForFile(file), kind }),
  restoreMedia: () => ipcRenderer.invoke('media:restore'),
  attachMedia: payload => ipcRenderer.invoke('media:attach', payload),
  fillPlatform: payload => ipcRenderer.invoke('platform:fill', payload),
  publish: id => ipcRenderer.invoke('platform:publish', id),
  runtimeInfo: () => ipcRenderer.invoke('app:runtime-info'),
  showLogs: () => ipcRenderer.invoke('app:show-logs'),
  resetLogins: () => ipcRenderer.invoke('app:reset-logins'),
  exportDiagnostics: () => ipcRenderer.invoke('app:export-diagnostics'),
  onStates: callback => ipcRenderer.on('platform:states', (_event, states) => callback(states))
});
