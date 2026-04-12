const path = require("path");
const { BrowserWindow } = require("electron");

function createWindowController(config, ipcMain, shell) {
  let mainWindow = null;

  function createWindow() {
    mainWindow = new BrowserWindow({
      width: 1200,
      height: 800,
      frame: false,
      backgroundColor: "#09090b",
      show: false,
      webPreferences: {
        preload: path.join(__dirname, "..", "..", "preload.js"),
        contextIsolation: true,
        nodeIntegration: false,
      },
    });

    mainWindow.loadURL(config.getFrontendUrl());

    mainWindow.once("ready-to-show", () => {
      mainWindow.show();
    });

    mainWindow.on("maximize", () => {
      mainWindow.webContents.send("window:maximized-changed", true);
    });

    mainWindow.on("unmaximize", () => {
      mainWindow.webContents.send("window:maximized-changed", false);
    });

    mainWindow.webContents.setWindowOpenHandler(({ url }) => {
      if (config.isLocalUrl(url)) {
        return { action: "allow" };
      }
      shell.openExternal(url);
      return { action: "deny" };
    });

    mainWindow.webContents.on("will-navigate", (event, url) => {
      if (!config.isLocalUrl(url)) {
        event.preventDefault();
        shell.openExternal(url);
      }
    });

    mainWindow.on("closed", () => {
      mainWindow = null;
    });

    return mainWindow;
  }

  function registerIpcHandlers() {
    ipcMain.handle("window:minimize", () => mainWindow?.minimize());
    ipcMain.handle("window:toggleMaximize", () => {
      if (mainWindow?.isMaximized()) {
        mainWindow.unmaximize();
      } else {
        mainWindow?.maximize();
      }
    });
    ipcMain.handle("window:close", () => mainWindow?.close());
    ipcMain.handle("window:isMaximized", () => mainWindow?.isMaximized() ?? false);
  }

  function getMainWindow() {
    return mainWindow;
  }

  return {
    createWindow,
    getMainWindow,
    registerIpcHandlers,
  };
}

module.exports = {
  createWindowController,
};
