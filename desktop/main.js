const { app, BrowserWindow, ipcMain, shell, clipboard } = require("electron");
const { spawn } = require("child_process");
const path = require("path");
const http = require("http");
const fs = require("fs");
const {
  ensureSimc, installVersion, listInstalledVersions,
  setActiveVersion, removeVersion, checkForUpdates,
  getLatestWeeklyRelease, getLatestNightlyRelease,
} = require("./scripts/download-simc");

let mainWindow = null;
let backend = null;

const isDev = !app.isPackaged;
const BACKEND_PORT = 17384;

// SimC lives in userData so it persists across app updates
function getSimcDir() {
  if (isDev) {
    return path.join(__dirname, "..", "backend", "resources", "simc");
  }
  return path.join(app.getPath("userData"), "simc");
}

let simcStatus = { ready: false, downloading: false, progress: 0, error: null };

// ── App preferences (stored in userData/settings.json) ──────────

function getSettingsPath() {
  if (isDev) return path.join(__dirname, "..", "backend", "resources", "settings.json");
  return path.join(app.getPath("userData"), "settings.json");
}

function loadSettings() {
  try {
    return JSON.parse(fs.readFileSync(getSettingsPath(), "utf-8"));
  } catch {
    return {};
  }
}

function saveSettings(settings) {
  fs.writeFileSync(getSettingsPath(), JSON.stringify(settings, null, 2));
}

function getSetting(key, defaultValue) {
  return loadSettings()[key] ?? defaultValue;
}

function setSetting(key, value) {
  const settings = loadSettings();
  settings[key] = value;
  saveSettings(settings);
}

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

  const env = {
    ...process.env,
    DATA_DIR: getResourcePath("data"),
    SIMC_DIR: getSimcDir(),
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

// SimC version management
ipcMain.handle("simc:status", () => simcStatus);

ipcMain.handle("simc:list-versions", () => {
  return { versions: listInstalledVersions(getSimcDir()) };
});

ipcMain.handle("simc:check-updates", () => checkForUpdates(getSimcDir()));

ipcMain.handle("simc:install-version", async (_event, release) => {
  const simcDir = getSimcDir();
  simcStatus = { ready: simcStatus.ready, downloading: true, progress: 0, error: null };
  mainWindow?.webContents.send("simc:status-changed", simcStatus);
  try {
    await installVersion(simcDir, release, (progress) => {
      simcStatus.progress = progress;
      mainWindow?.webContents.send("simc:download-progress", progress);
    });
    simcStatus = { ...simcStatus, downloading: false, progress: 1 };
    mainWindow?.webContents.send("simc:status-changed", simcStatus);
    return { success: true };
  } catch (err) {
    simcStatus = { ...simcStatus, downloading: false, error: err.message };
    mainWindow?.webContents.send("simc:status-changed", simcStatus);
    return { success: false, error: err.message };
  }
});

ipcMain.handle("simc:remove-version", (_event, tag) => {
  removeVersion(getSimcDir(), tag);
  return { success: true };
});

// App settings
ipcMain.handle("settings:get", (_event, key, defaultValue) => getSetting(key, defaultValue));
ipcMain.handle("settings:set", (_event, key, value) => {
  setSetting(key, value);
});

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

  // Ensure at least one simc version is installed
  const simcDir = getSimcDir();
  try {
    simcStatus = { ready: false, downloading: true, progress: 0, error: null };
    await ensureSimc(simcDir, (progress) => {
      simcStatus.progress = progress;
      mainWindow?.webContents.send("simc:download-progress", progress);
    });
    simcStatus = { ready: true, downloading: false, progress: 1, error: null };
    console.log("[simc] Ready");
  } catch (err) {
    console.error("[simc] Download failed:", err.message);
    simcStatus = { ready: false, downloading: false, progress: 0, error: err.message };
  }

  // Auto-update: download and activate latest release if enabled
  const autoUpdate = getSetting("simc_auto_update", true);
  const useNightly = getSetting("simc_use_nightly", false);
  if (autoUpdate) {
    try {
      const fetcher = useNightly ? getLatestNightlyRelease : getLatestWeeklyRelease;
      const release = await fetcher();
      if (release) {
        const installed = listInstalledVersions(simcDir);
        const alreadyInstalled = installed.some((v) => v.tag === release.tag);
        if (!alreadyInstalled) {
          console.log(`[simc] Auto-updating to ${release.tag}...`);
          simcStatus = { ...simcStatus, downloading: true, progress: 0 };
          await installVersion(simcDir, release, (progress) => {
            simcStatus.progress = progress;
            mainWindow?.webContents.send("simc:download-progress", progress);
          });
          setActiveVersion(simcDir, release.tag);
          simcStatus = { ready: true, downloading: false, progress: 1, error: null };
          console.log(`[simc] Auto-updated to ${release.tag}`);
        }
      }
    } catch (err) {
      console.warn("[simc] Auto-update check failed:", err.message);
    }
  }

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
