const {
  checkForUpdates,
  ensureSimc,
  getLatestNightlyRelease,
  getLatestWeeklyRelease,
  getActiveBinaryPath,
  installVersion,
  listInstalledVersions,
  removeVersion,
  setActiveVersion,
} = require("../../scripts/download-simc");

function createSimcController(ipcMain, config, settingsStore, getMainWindow) {
  let simcStatus = { ready: false, downloading: false, progress: 0, error: null };

  function emitStatusChanged() {
    getMainWindow()?.webContents.send("simc:status-changed", simcStatus);
  }

  function emitDownloadProgress(progress) {
    simcStatus = { ...simcStatus, progress };
    getMainWindow()?.webContents.send("simc:download-progress", progress);
  }

  function setStatus(nextStatus, notify = true) {
    simcStatus = nextStatus;
    if (notify) {
      emitStatusChanged();
    }
  }

  function registerIpcHandlers() {
    ipcMain.handle("simc:status", () => simcStatus);

    ipcMain.handle("simc:list-versions", () => {
      return { versions: listInstalledVersions(config.getSimcDir()) };
    });

    ipcMain.handle("simc:check-updates", () => checkForUpdates(config.getSimcDir()));

    ipcMain.handle("simc:install-version", async (_event, release) => {
      const simcDir = config.getSimcDir();
      setStatus({ ready: simcStatus.ready, downloading: true, progress: 0, error: null });

      try {
        await installVersion(simcDir, release, (progress) => {
          emitDownloadProgress(progress);
        });
        if (!getActiveBinaryPath(simcDir)) {
          setActiveVersion(simcDir, release.tag);
        }
        setStatus({ ...simcStatus, downloading: false, progress: 1 });
        return { success: true };
      } catch (err) {
        setStatus({
          ...simcStatus,
          downloading: false,
          error: err.message,
        });
        return { success: false, error: err.message };
      }
    });

    ipcMain.handle("simc:remove-version", (_event, tag) => {
      removeVersion(config.getSimcDir(), tag);
      return { success: true };
    });
  }

  async function ensureReady() {
    const simcDir = config.getSimcDir();

    try {
      setStatus({ ready: false, downloading: true, progress: 0, error: null }, false);
      await ensureSimc(simcDir, (progress) => {
        emitDownloadProgress(progress);
      });
      setStatus({ ready: true, downloading: false, progress: 1, error: null }, false);
      console.log("[simc] Ready");
    } catch (err) {
      console.error("[simc] Download failed:", err.message);
      setStatus(
        {
          ready: false,
          downloading: false,
          progress: 0,
          error: err.message,
        },
        false
      );
    }
  }

  async function autoUpdateInstalledVersion() {
    const autoUpdate = settingsStore.getSetting("simc_auto_update", true);
    const useNightly = settingsStore.getSetting("simc_use_nightly", false);

    if (!autoUpdate) {
      return;
    }

    try {
      const fetcher = useNightly ? getLatestNightlyRelease : getLatestWeeklyRelease;
      const release = await fetcher();
      if (!release) {
        return;
      }

      const simcDir = config.getSimcDir();
      const installed = listInstalledVersions(simcDir);
      const alreadyInstalled = installed.some((version) => version.tag === release.tag);

      if (alreadyInstalled) {
        return;
      }

      console.log(`[simc] Auto-updating to ${release.tag}...`);
      setStatus({ ...simcStatus, downloading: true, progress: 0 }, false);
      await installVersion(simcDir, release, (progress) => {
        emitDownloadProgress(progress);
      });
      setActiveVersion(simcDir, release.tag);
      setStatus({ ready: true, downloading: false, progress: 1, error: null }, false);
      console.log(`[simc] Auto-updated to ${release.tag}`);
    } catch (err) {
      console.warn("[simc] Auto-update check failed:", err.message);
    }
  }

  return {
    autoUpdateInstalledVersion,
    ensureReady,
    registerIpcHandlers,
  };
}

module.exports = {
  createSimcController,
};
