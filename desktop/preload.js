const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("electronAPI", {
  // Window controls
  minimize: () => ipcRenderer.invoke("window:minimize"),
  toggleMaximize: () => ipcRenderer.invoke("window:toggleMaximize"),
  close: () => ipcRenderer.invoke("window:close"),
  isMaximized: () => ipcRenderer.invoke("window:isMaximized"),
  onMaximizedChange: (callback) => {
    const handler = (_event, maximized) => callback(maximized);
    ipcRenderer.on("window:maximized-changed", handler);
    return () => ipcRenderer.removeListener("window:maximized-changed", handler);
  },

  // Auto-updater
  checkForUpdate: () => ipcRenderer.invoke("updater:check"),
  downloadAndInstall: () => ipcRenderer.invoke("updater:downloadAndInstall"),
  onUpdateAvailable: (callback) => {
    const handler = (_event, version) => callback(version);
    ipcRenderer.on("updater:update-available", handler);
    return () => ipcRenderer.removeListener("updater:update-available", handler);
  },
  onDownloadProgress: (callback) => {
    const handler = (_event, percent) => callback(percent);
    ipcRenderer.on("updater:download-progress", handler);
    return () => ipcRenderer.removeListener("updater:download-progress", handler);
  },

  // Clipboard monitoring
  startClipboardPolling: (intervalMs) => ipcRenderer.invoke("clipboard:start-polling", intervalMs),
  stopClipboardPolling: () => ipcRenderer.invoke("clipboard:stop-polling"),
  readClipboard: () => ipcRenderer.invoke("clipboard:read"),
  onClipboardChange: (callback) => {
    const handler = (_event, text) => callback(text);
    ipcRenderer.on("clipboard:changed", handler);
    return () => ipcRenderer.removeListener("clipboard:changed", handler);
  },

  // SimC version management
  getSimcStatus: () => ipcRenderer.invoke("simc:status"),
  listSimcVersions: () => ipcRenderer.invoke("simc:list-versions"),
  checkSimcUpdates: () => ipcRenderer.invoke("simc:check-updates"),
  installSimcVersion: (release) => ipcRenderer.invoke("simc:install-version", release),
  removeSimcVersion: (tag) => ipcRenderer.invoke("simc:remove-version", tag),
  onSimcDownloadProgress: (callback) => {
    const handler = (_event, progress) => callback(progress);
    ipcRenderer.on("simc:download-progress", handler);
    return () => ipcRenderer.removeListener("simc:download-progress", handler);
  },
  onSimcStatusChanged: (callback) => {
    const handler = (_event, status) => callback(status);
    ipcRenderer.on("simc:status-changed", handler);
    return () => ipcRenderer.removeListener("simc:status-changed", handler);
  },

  // App settings
  getSetting: (key, defaultValue) => ipcRenderer.invoke("settings:get", key, defaultValue),
  setSetting: (key, value) => ipcRenderer.invoke("settings:set", key, value),
});
