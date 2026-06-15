const path = require("path");

// Preferred port tried first on startup; falls back to an OS-chosen ephemeral
// port if held (e.g. orphan backend from a crash). See findFreePort() in backend.js.
const DEFAULT_BACKEND_PORT = 17384;

function createAppConfig(app) {
  const isDev = !app.isPackaged;
  let backendPort = DEFAULT_BACKEND_PORT;

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

  function getUserDataPath() {
    return app.getPath("userData");
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
    return `http://127.0.0.1:${backendPort}`;
  }

  function isLocalUrl(url) {
    return url.startsWith("http://127.0.0.1") || url.startsWith("http://localhost");
  }

  return {
    get BACKEND_PORT() {
      return backendPort;
    },
    setBackendPort(port) {
      backendPort = port;
    },
    DEFAULT_BACKEND_PORT,
    isDev,
    getBackendBinary,
    getFrontendUrl,
    getResourcePath,
    getSimcDir,
    getUserDataPath,
    isLocalUrl,
  };
}

module.exports = {
  DEFAULT_BACKEND_PORT,
  createAppConfig,
};
