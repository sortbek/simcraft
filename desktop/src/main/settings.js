const fs = require("fs");
const path = require("path");

function createSettingsStore(app, isDev) {
  function getSettingsPath() {
    if (isDev) {
      return path.join(__dirname, "..", "..", "..", "backend", "resources", "settings.json");
    }
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

  return {
    getSetting,
    getSettingsPath,
    loadSettings,
    saveSettings,
    setSetting,
  };
}

module.exports = {
  createSettingsStore,
};
