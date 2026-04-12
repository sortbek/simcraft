const fs = require("fs");
const path = require("path");
const { session } = require("electron");

async function clearCacheIfVersionChanged(app) {
  const versionFile = path.join(app.getPath("userData"), ".last-version");
  const currentVersion = app.getVersion();
  let previousVersion = null;

  try {
    previousVersion = fs.readFileSync(versionFile, "utf-8").trim();
  } catch {}

  if (previousVersion && previousVersion !== currentVersion) {
    console.log(`Version changed (${previousVersion} -> ${currentVersion}), clearing web cache`);
    await session.defaultSession.clearCache();
    await session.defaultSession.clearStorageData({
      storages: ["cachestorage", "serviceworkers"],
    });
  }

  fs.writeFileSync(versionFile, currentVersion);
}

module.exports = {
  clearCacheIfVersionChanged,
};
