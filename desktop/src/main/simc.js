const {
  checkForUpdates,
  ensureSimc,
  getLatestNightlyRelease,
  getLatestWeeklyRelease,
  getActiveBinaryPath,
  getActiveVersion,
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
    const simcDir = config.getSimcDir();
    const branches = autoUpdateBranches(
      (key, fallback) => settingsStore.getSetting(key, fallback),
      listInstalledVersions(simcDir)
    );

    for (const branch of branches) {
      try {
        const fetcher = branch === "nightly" ? getLatestNightlyRelease : getLatestWeeklyRelease;
        const release = await fetcher();
        if (!release || listInstalledVersions(simcDir).some((v) => v.tag === release.tag)) {
          continue;
        }

        // Installing drops the branch's old build, which may be the active one.
        const wasActive = (getActiveVersion(simcDir) ?? "").startsWith(`${branch}-`);
        console.log(`[simc] Auto-updating to ${release.tag}...`);
        setStatus({ ...simcStatus, downloading: true, progress: 0 }, false);
        await installVersion(simcDir, release, (progress) => {
          emitDownloadProgress(progress);
        });
        if (wasActive) setActiveVersion(simcDir, release.tag);
        setStatus({ ready: true, downloading: false, progress: 1, error: null }, false);
        console.log(`[simc] Auto-updated to ${release.tag}`);
      } catch (err) {
        setStatus({ ...simcStatus, downloading: false }, false);
        console.warn(`[simc] Auto-update of ${branch} failed:`, err.message);
      }
    }
  }

  return {
    autoUpdateInstalledVersion,
    ensureReady,
    registerIpcHandlers,
  };
}

/** Branches to update at startup: each one installed with its own switch on.
 *  The keys predate per-branch switches: simc_auto_update is Weekly's, simc_use_nightly Nightly's. */
function autoUpdateBranches(getSetting, installed) {
  const on = {
    weekly: getSetting("simc_auto_update", true),
    nightly: getSetting("simc_use_nightly", false),
  };
  return ["weekly", "nightly"].filter(
    (branch) => on[branch] && installed.some((v) => v.type === branch)
  );
}

module.exports = {
  autoUpdateBranches,
  createSimcController,
};
