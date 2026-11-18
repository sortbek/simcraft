const fs = require("fs");
const path = require("path");
const {
  activeTag,
  ensureForever,
  install,
  latestTag,
  setDisabled,
} = require("../../scripts/download-forever");

/** The WoW Forever engine: installed and updated in the background, never in the way of startup.
 *  The backend picks up a new install on its next Forever request, so nothing restarts. */
function createForeverController(ipcMain, config, settingsStore, getMainWindow) {
  let busy = false;

  const enabled = () => settingsStore.getSetting("forever_enabled", true);
  const autoUpdate = () => settingsStore.getSetting("forever_auto_update", true);
  const sendProgress = (progress) =>
    getMainWindow()?.webContents.send("forever:download-progress", progress);

  function status() {
    const dir = config.getForeverDir();
    const installed = activeTag(dir);
    let version = {};
    try {
      version = JSON.parse(fs.readFileSync(path.join(dir, installed, "data", "version.json"), "utf8"));
    } catch {
      // not installed, or a bundle without version.json
    }
    return {
      enabled: enabled(),
      autoUpdate: autoUpdate(),
      installed,
      engineCommit: version.engine_commit ?? null,
      clientBuild: version.client_build ?? null,
      busy,
    };
  }

  /** One install or update at a time; a failure is the caller's to show. */
  async function run(task) {
    if (busy) throw new Error("The Forever engine is already updating");
    busy = true;
    try {
      return await task();
    } finally {
      busy = false;
    }
  }

  /** At startup, in the background: install when missing, update when allowed. */
  function start() {
    run(() =>
      ensureForever(config.getForeverDir(), { enabled: enabled(), autoUpdate: autoUpdate() })
    ).catch((err) => console.warn(`[forever] ${err.message}`));
  }

  function registerIpcHandlers() {
    ipcMain.handle("forever:status", () => status());
    ipcMain.handle("forever:check-update", async () => {
      const latest = await latestTag();
      return { latest, installed: activeTag(config.getForeverDir()) };
    });
    ipcMain.handle("forever:install-latest", async () => {
      await run(async () => {
        const dir = config.getForeverDir();
        fs.mkdirSync(dir, { recursive: true });
        const tag = await latestTag();
        if (tag !== activeTag(dir)) await install(dir, tag, sendProgress);
      });
      return status();
    });
    ipcMain.handle("forever:set-enabled", (_event, value) => {
      settingsStore.setSetting("forever_enabled", !!value);
      setDisabled(config.getForeverDir(), !value);
      if (value) start();
      return status();
    });
    ipcMain.handle("forever:set-auto-update", (_event, value) => {
      settingsStore.setSetting("forever_auto_update", !!value);
      return status();
    });
  }

  return { start, registerIpcHandlers };
}

module.exports = { createForeverController };
