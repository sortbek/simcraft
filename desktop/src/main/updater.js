function setupAutoUpdater(app, ipcMain, getMainWindow) {
  try {
    const { autoUpdater } = require("electron-updater");
    autoUpdater.autoDownload = false;
    autoUpdater.disableDifferentialDownload = true;
    autoUpdater.allowPrerelease = app.getVersion().includes("-dev.");

    let availableUpdate = null;

    autoUpdater.on("update-available", (info) => {
      if (info.version !== app.getVersion()) {
        availableUpdate = { version: info.version };
        getMainWindow()?.webContents.send("updater:update-available", info.version);
      }
    });

    autoUpdater.on("download-progress", (progress) => {
      getMainWindow()?.webContents.send("updater:download-progress", progress.percent);
    });

    autoUpdater.on("error", (err) => {
      console.warn("Auto-updater error:", err.message);
    });

    ipcMain.handle("updater:check", async () => {
      if (availableUpdate) {
        return availableUpdate;
      }

      try {
        await autoUpdater.checkForUpdates();
        return availableUpdate;
      } catch {
        return null;
      }
    });

    ipcMain.handle("updater:downloadAndInstall", async () => {
      await autoUpdater.downloadUpdate();
      setImmediate(() => autoUpdater.quitAndInstall(false, true));
    });

    setTimeout(() => autoUpdater.checkForUpdates().catch(() => {}), 5000);
  } catch {
    // electron-updater is not available in development.
  }
}

module.exports = {
  setupAutoUpdater,
};
