const { app, BrowserWindow, ipcMain, shell, clipboard } = require("electron");
const { spawn } = require("child_process");
const path = require("path");
const http = require("http");

let mainWindow = null;
let backend = null;

const isDev = !app.isPackaged;
const BACKEND_PORT = 17384;

function getResourcePath(type, ...segments) {
  if (isDev) {
    return path.join(__dirname, "..", "backend", "resources", type, ...segments);
  }
  return path.join(process.resourcesPath, type, ...segments);
}

function getBackendBinary() {
  const name = process.platform === "win32" ? "simhammer-server.exe" : "simhammer-server";
  if (isDev) {
    return path.join(__dirname, "..", "backend", "target", "debug", name);
  }
  return path.join(process.resourcesPath, "backend", name);
}

function startBackend() {
  const binary = getBackendBinary();
  const simcName = process.platform === "win32" ? "simc.exe" : "simc";

  const env = {
    ...process.env,
    DATA_DIR: getResourcePath("data"),
    SIMC_PATH: getResourcePath("simc", simcName),
    RUST_BACKTRACE: "1",
    PORT: String(BACKEND_PORT),
    BIND_HOST: "127.0.0.1",
  };

  // In production, serve the bundled frontend from the backend
  if (!isDev) {
    env.FRONTEND_DIR = getResourcePath("frontend");
  }

  backend = spawn(binary, ["--desktop"], { env, stdio: ["ignore", "pipe", "pipe"] });

  backend.stdout.on("data", (data) => {
    process.stdout.write(`[backend] ${data}`);
  });

  backend.stderr.on("data", (data) => {
    process.stderr.write(`[backend] ${data}`);
  });

  backend.on("error", (err) => {
    console.error("Failed to start backend:", err.message);
  });

  backend.on("exit", (code) => {
    console.log(`Backend exited with code ${code}`);
    backend = null;
  });
}

function waitForBackend(timeout = 30000) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    function check() {
      if (Date.now() - start > timeout) {
        return reject(new Error("Backend did not start in time"));
      }
      const req = http.get(`http://127.0.0.1:${BACKEND_PORT}/health`, (res) => {
        if (res.statusCode === 200) {
          resolve();
        } else {
          setTimeout(check, 200);
        }
      });
      req.on("error", () => setTimeout(check, 200));
      req.setTimeout(1000, () => {
        req.destroy();
        setTimeout(check, 200);
      });
    }
    check();
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    frame: false,
    backgroundColor: "#09090b",
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  if (isDev) {
    mainWindow.loadURL("http://localhost:3000");
  } else {
    mainWindow.loadURL(`http://127.0.0.1:${BACKEND_PORT}`);
  }

  mainWindow.once("ready-to-show", () => {
    mainWindow.show();
  });

  mainWindow.on("maximize", () => {
    mainWindow.webContents.send("window:maximized-changed", true);
  });

  mainWindow.on("unmaximize", () => {
    mainWindow.webContents.send("window:maximized-changed", false);
  });

  // Open external links in the system browser instead of Electron
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith("http://127.0.0.1") || url.startsWith("http://localhost")) {
      return { action: "allow" };
    }
    shell.openExternal(url);
    return { action: "deny" };
  });

  mainWindow.webContents.on("will-navigate", (event, url) => {
    if (!url.startsWith("http://127.0.0.1") && !url.startsWith("http://localhost")) {
      event.preventDefault();
      shell.openExternal(url);
    }
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

// IPC handlers for window controls
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

// Clipboard polling
let clipboardInterval = null;
let lastClipboardText = "";

ipcMain.handle("clipboard:start-polling", (_event, intervalMs) => {
  if (clipboardInterval) clearInterval(clipboardInterval);
  lastClipboardText = clipboard.readText();
  clipboardInterval = setInterval(() => {
    const text = clipboard.readText();
    if (text && text !== lastClipboardText) {
      lastClipboardText = text;
      mainWindow?.webContents.send("clipboard:changed", text);
    }
  }, intervalMs || 2000);
});

ipcMain.handle("clipboard:stop-polling", () => {
  if (clipboardInterval) {
    clearInterval(clipboardInterval);
    clipboardInterval = null;
  }
});

ipcMain.handle("clipboard:read", () => clipboard.readText());

// Auto-updater
function setupAutoUpdater() {
  try {
    const { autoUpdater } = require("electron-updater");
    autoUpdater.autoDownload = false;
    autoUpdater.disableDifferentialDownload = true;
    autoUpdater.allowPrerelease = app.getVersion().includes("-dev.");

    let availableUpdate = null;

    autoUpdater.on("update-available", (info) => {
      if (info.version !== app.getVersion()) {
        availableUpdate = { version: info.version };
        mainWindow?.webContents.send("updater:update-available", info.version);
      }
    });

    autoUpdater.on("download-progress", (progress) => {
      mainWindow?.webContents.send("updater:download-progress", progress.percent);
    });

    autoUpdater.on("error", (err) => {
      console.warn("Auto-updater error:", err.message);
    });

    ipcMain.handle("updater:check", async () => {
      // Return cached result if we already detected an update
      if (availableUpdate) return availableUpdate;
      try {
        await autoUpdater.checkForUpdates();
        // Result is set via update-available event above
        return availableUpdate;
      } catch {
        return null;
      }
    });

    ipcMain.handle("updater:downloadAndInstall", async () => {
      await autoUpdater.downloadUpdate();
      // Defer quitAndInstall so the IPC response can return first,
      // otherwise the app gets stuck mid-quit while the renderer awaits the reply.
      setImmediate(() => autoUpdater.quitAndInstall(false, true));
    });

    // Check for updates after a short delay
    setTimeout(() => autoUpdater.checkForUpdates().catch(() => {}), 5000);
  } catch {
    // electron-updater not available in dev
  }
}

async function clearCacheIfVersionChanged() {
  const fs = require("fs");
  const versionFile = path.join(app.getPath("userData"), ".last-version");
  const current = app.getVersion();
  let previous = null;
  try {
    previous = fs.readFileSync(versionFile, "utf-8").trim();
  } catch {}
  if (previous && previous !== current) {
    console.log(`Version changed (${previous} → ${current}), clearing web cache`);
    const session = require("electron").session.defaultSession;
    await session.clearCache();
    await session.clearStorageData({ storages: ["cachestorage", "serviceworkers"] });
  }
  fs.writeFileSync(versionFile, current);
}

app.whenReady().then(async () => {
  await clearCacheIfVersionChanged();
  startBackend();

  try {
    await waitForBackend();
  } catch (err) {
    console.error(err.message);
    app.quit();
    return;
  }

  createWindow();
  setupAutoUpdater();
});

app.on("window-all-closed", () => {
  app.quit();
});

app.on("before-quit", () => {
  if (clipboardInterval) {
    clearInterval(clipboardInterval);
    clipboardInterval = null;
  }
  if (backend) {
    backend.kill();
    backend = null;
  }
});

// macOS: re-create window when dock icon clicked
app.on("activate", () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});
