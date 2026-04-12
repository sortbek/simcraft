const http = require("http");
const { spawn } = require("child_process");

function createBackendController(config) {
  let backend = null;

  function start() {
    const env = {
      ...process.env,
      DATA_DIR: config.getResourcePath("data"),
      SIMC_DIR: config.getSimcDir(),
      RUST_BACKTRACE: "1",
      PORT: String(config.BACKEND_PORT),
      BIND_HOST: "127.0.0.1",
    };

    if (!config.isDev) {
      env.FRONTEND_DIR = config.getResourcePath("frontend");
    }

    backend = spawn(config.getBackendBinary(), ["--desktop"], {
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });

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

  function waitForReady(timeout = 30000) {
    const startTime = Date.now();

    return new Promise((resolve, reject) => {
      function check() {
        if (Date.now() - startTime > timeout) {
          reject(new Error("Backend did not start in time"));
          return;
        }

        const req = http.get(`http://127.0.0.1:${config.BACKEND_PORT}/health`, (res) => {
          if (res.statusCode === 200) {
            resolve();
            return;
          }
          setTimeout(check, 200);
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

  function stop() {
    if (backend) {
      backend.kill();
      backend = null;
    }
  }

  return {
    start,
    stop,
    waitForReady,
  };
}

module.exports = {
  createBackendController,
};
