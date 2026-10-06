const path = require("path");
const { app, BrowserWindow, clipboard, dialog, ipcMain, shell } = require("electron");

const { createBackendController, findFreePort } = require("./src/main/backend");
const { clearCacheIfVersionChanged } = require("./src/main/cache");
const { createClipboardController } = require("./src/main/clipboard");
const { createAppConfig } = require("./src/main/config");
const { PROTOCOL, parseDeepLink, findDeepLinkInArgv } = require("./src/main/deeplink");
const { createSettingsStore } = require("./src/main/settings");
const { createSimcController } = require("./src/main/simc");
const { setupAutoUpdater } = require("./src/main/updater");
const { createWindowController } = require("./src/main/window");

// Prevent a second instance from launching with the same user-data directory
// and SimC binary path. If the user double-clicks the app icon while it's
// already running, focus the existing window instead.
if (!app.requestSingleInstanceLock()) {
  app.quit();
  process.exit(0);
}

// Registration. A dev run (`electron .`) would take simhammer:// over from the
// installed app for good, so it only registers when asked to.
if (!process.defaultApp) {
  app.setAsDefaultProtocolClient(PROTOCOL);
} else if (process.env.SIMHAMMER_DEV_PROTOCOL === "1" && process.argv.length >= 2) {
  app.setAsDefaultProtocolClient(PROTOCOL, process.execPath, [path.resolve(process.argv[1])]);
}

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

let pendingShareId = findDeepLinkInArgv(process.argv);

function focusMainWindow() {
  const win = windowController.getMainWindow();
  if (win) {
    if (win.isMinimized()) win.restore();
    win.focus();
  }
  return win;
}

// A running app routes inside the page (no reload, so unsaved setup and a live
// sim view survive); only a cold start loads the share URL directly.
function openShare(id) {
  const win = focusMainWindow();
  if (!win) {
    pendingShareId = id;
    return;
  }
  if (win.webContents.isLoading()) {
    win.loadURL(`${config.getFrontendUrl()}/shared?id=${id}`);
  } else {
    win.webContents.send("deeplink:open-share", id);
  }
}

app.on("second-instance", (_event, argv) => {
  focusMainWindow();
  const id = findDeepLinkInArgv(argv);
  if (id) openShare(id);
});

app.on("open-url", (event, url) => {
  event.preventDefault();
  const id = parseDeepLink(url);
  if (id) openShare(id);
});

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

  // Pick a port before spawning. Tries 17384 first; falls back to an
  // OS-chosen ephemeral port if it's held (e.g. by an orphan backend
  // from a previous crash that didn't get cleaned up).
  const port = await findFreePort(config.DEFAULT_BACKEND_PORT);
  config.setBackendPort(port);
  if (port !== config.DEFAULT_BACKEND_PORT) {
    console.log(`Backend port ${config.DEFAULT_BACKEND_PORT} in use, using ${port} instead`);
  }

  backendController.start();

  try {
    await backendController.waitForReady();
  } catch (err) {
    console.error(err.message);
    dialog.showErrorBox(
      "SimHammer",
      `The backend failed to start.\n\n${err.message}\n\nIf this keeps happening, restart your computer or report the issue on GitHub.`
    );
    app.quit();
    return;
  }

  windowController.createWindow();
  if (pendingShareId) {
    const id = pendingShareId;
    pendingShareId = null;
    // The page has no listener yet on a cold start, so load the share itself.
    windowController
      .getMainWindow()
      .webContents.once("did-finish-load", () =>
        windowController.getMainWindow().loadURL(`${config.getFrontendUrl()}/shared?id=${id}`)
      );
  }
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
