const { app, BrowserWindow, clipboard, ipcMain, shell } = require("electron");

const { createBackendController } = require("./src/main/backend");
const { clearCacheIfVersionChanged } = require("./src/main/cache");
const { createClipboardController } = require("./src/main/clipboard");
const { createAppConfig } = require("./src/main/config");
const { createSettingsStore } = require("./src/main/settings");
const { createSimcController } = require("./src/main/simc");
const { setupAutoUpdater } = require("./src/main/updater");
const { createWindowController } = require("./src/main/window");

const config = createAppConfig(app);
const settingsStore = createSettingsStore(app, config.isDev);
const windowController = createWindowController(config, ipcMain, shell);
const backendController = createBackendController(config);
const clipboardController = createClipboardController(
  ipcMain,
  clipboard,
  windowController.getMainWindow
);
const simcController = createSimcController(
  ipcMain,
  config,
  settingsStore,
  windowController.getMainWindow
);

windowController.registerIpcHandlers();
clipboardController.registerIpcHandlers();
simcController.registerIpcHandlers();

ipcMain.handle("settings:get", (_event, key, defaultValue) =>
  settingsStore.getSetting(key, defaultValue)
);
ipcMain.handle("settings:set", (_event, key, value) => {
  settingsStore.setSetting(key, value);
});

app.whenReady().then(async () => {
  await clearCacheIfVersionChanged(app);
  await simcController.ensureReady();
  await simcController.autoUpdateInstalledVersion();

  backendController.start();

  try {
    await backendController.waitForReady();
  } catch (err) {
    console.error(err.message);
    app.quit();
    return;
  }

  windowController.createWindow();
  setupAutoUpdater(app, ipcMain, windowController.getMainWindow);
});

app.on("window-all-closed", () => {
  app.quit();
});

app.on("before-quit", () => {
  clipboardController.stopPolling();
  backendController.stop();
});

app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    windowController.createWindow();
  }
});
