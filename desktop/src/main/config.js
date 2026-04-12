const path = require("path");

const BACKEND_PORT = 17384;

function createAppConfig(app) {
  const isDev = !app.isPackaged;

  function getSimcDir() {
    if (isDev) {
      return path.join(__dirname, "..", "..", "..", "backend", "resources", "simc");
    }
    return path.join(app.getPath("userData"), "simc");
  }

  function getResourcePath(type, ...segments) {
    if (isDev) {
      return path.join(__dirname, "..", "..", "..", "backend", "resources", type, ...segments);
    }
    return path.join(process.resourcesPath, type, ...segments);
  }

  function getBackendBinary() {
    const name = process.platform === "win32" ? "simhammer-server.exe" : "simhammer-server";
    if (isDev) {
      return path.join(__dirname, "..", "..", "..", "backend", "target", "debug", name);
    }
    return path.join(process.resourcesPath, "backend", name);
  }

  function getFrontendUrl() {
    if (isDev) {
      return "http://localhost:3000";
    }
    return `http://127.0.0.1:${BACKEND_PORT}`;
  }

  function isLocalUrl(url) {
    return url.startsWith("http://127.0.0.1") || url.startsWith("http://localhost");
  }

  return {
    BACKEND_PORT,
    isDev,
    getBackendBinary,
    getFrontendUrl,
    getResourcePath,
    getSimcDir,
    isLocalUrl,
  };
}

module.exports = {
  BACKEND_PORT,
  createAppConfig,
};
