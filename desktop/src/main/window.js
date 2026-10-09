const fs = require("fs");
const path = require("path");
const { app, BrowserWindow, screen } = require("electron");
const { defaultWindowBounds, restoreWindowBounds } = require("./windowBounds");

// Its own file in userData: the dev settings.json is tracked in the repo.
const statePath = () => path.join(app.getPath("userData"), "window-state.json");

function loadWindowState() {
  try {
    return JSON.parse(fs.readFileSync(statePath(), "utf-8"));
  } catch {
    return null;
  }
}

function saveWindowState(win) {
  try {
    // Normal bounds are the restored size, even while maximized.
    const state = { ...win.getNormalBounds(), maximized: win.isMaximized() };
    fs.writeFileSync(statePath(), JSON.stringify(state));
  } catch {
    // Not worth failing a close over.
  }
}

function createWindowController(config, ipcMain, shell) {
  let mainWindow = null;

  function createWindow() {
    const saved = loadWindowState();
    const workAreas = screen.getAllDisplays().map((d) => d.workArea);
    const bounds =
      restoreWindowBounds(saved, workAreas) ??
      defaultWindowBounds(screen.getPrimaryDisplay().workArea);

    mainWindow = new BrowserWindow({
      ...bounds,
      frame: false,
      backgroundColor: "#0d0c0b",
      show: false,
      webPreferences: {
        preload: path.join(__dirname, "..", "..", "preload.js"),
        contextIsolation: true,
        nodeIntegration: false,
      },
    });

    mainWindow.loadURL(config.getFrontendUrl());

    mainWindow.once("ready-to-show", () => {
      if (saved?.maximized) mainWindow.maximize();
      mainWindow.show();
    });

    mainWindow.on("close", () => saveWindowState(mainWindow));

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
