const { spawn, execSync } = require("child_process");
const path = require("path");
const fs = require("fs");
const http = require("http");
const https = require("https");

const ROOT = path.join(__dirname, "..", "..");
const BACKEND_DIR = path.join(ROOT, "backend");
const FRONTEND_DIR = path.join(ROOT, "frontend");

const ext = process.platform === "win32" ? ".exe" : "";
const serverBinary = path.join(BACKEND_DIR, "target", "debug", `simhammer-server${ext}`);

function findNewestMtime(dir, extension) {
  let newest = 0;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory() && entry.name !== "target" && entry.name !== "node_modules") {
      newest = Math.max(newest, findNewestMtime(full, extension));
    } else if (entry.isFile() && entry.name.endsWith(extension)) {
      newest = Math.max(newest, fs.statSync(full).mtimeMs);
    }
  }
  return newest;
}

function buildBackend() {
  console.log("[dev] Building Rust backend...");
  execSync("cargo build -p simhammer-server --features desktop", {
    cwd: BACKEND_DIR,
    stdio: "inherit",
  });
  console.log("[dev] Backend built.");
}

function waitForUrl(url, timeout = 30000) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    function check() {
      if (Date.now() - start > timeout) {
        return reject(new Error(`Timed out waiting for ${url}`));
      }
      const req = http.get(url, (res) => {
        if (res.statusCode === 200) resolve();
        else setTimeout(check, 300);
      });
      req.on("error", () => setTimeout(check, 300));
      req.setTimeout(1000, () => {
        req.destroy();
        setTimeout(check, 300);
      });
    }
    check();
  });
}

function download(url) {
  return new Promise((resolve, reject) => {
    const mod = url.startsWith("https") ? https : http;
    mod.get(url, { headers: { "User-Agent": "SimHammer" } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        return download(res.headers.location).then(resolve, reject);
      }
      if (res.statusCode !== 200) {
        return reject(new Error(`HTTP ${res.statusCode} for ${url}`));
      }
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => resolve(Buffer.concat(chunks)));
      res.on("error", reject);
    }).on("error", reject);
  });
}

async function fetchGameData(dataDir) {
  const BASE_URL = "https://www.raidbots.com/static/data/live";

  fs.mkdirSync(dataDir, { recursive: true });

  console.log("[dev] Fetching metadata.json...");
  const metaBuf = await download(`${BASE_URL}/metadata.json`);
  fs.writeFileSync(path.join(dataDir, "metadata.json"), metaBuf);

  const metadata = JSON.parse(metaBuf.toString());
  const files = metadata.files || [];

  console.log(`[dev] Downloading ${files.length} data files...`);
  for (const file of files) {
    process.stdout.write(`  ${file}... `);
    try {
      const buf = await download(`${BASE_URL}/${file}`);
      fs.writeFileSync(path.join(dataDir, file), buf);
      console.log("ok");
    } catch (err) {
      console.log(`skipped (${err.message})`);
    }
  }

  // Copy season-config.json (manually maintained, not on Raidbots)
  const seasonConfig = path.join(BACKEND_DIR, "core", "season-config.json");
  if (fs.existsSync(seasonConfig)) {
    fs.copyFileSync(seasonConfig, path.join(dataDir, "season-config.json"));
    console.log("[dev] Copied season-config.json");
  }

  // Fetch Blizzard data (season + instance images)
  for (const [file, url] of [
    ["blizzard-season.json", "https://simhammer.com/api/blizzard/season"],
    ["blizzard-instances.json", "https://simhammer.com/api/blizzard/instances"],
  ]) {
    try {
      process.stdout.write(`[dev] Fetching ${file}... `);
      const buf = await download(url);
      fs.writeFileSync(path.join(dataDir, file), buf);
      console.log("ok");
    } catch {
      console.log("skipped (unreachable)");
    }
  }
}

async function ensureResources() {
  const dataDir = path.join(BACKEND_DIR, "resources", "data");
  const simcDir = path.join(BACKEND_DIR, "resources", "simc");
  const simcBinary = path.join(simcDir, process.platform === "win32" ? "simc.exe" : "simc");
  const metadataFile = path.join(dataDir, "metadata.json");

  // Build simc binary if missing
  if (!fs.existsSync(simcBinary)) {
    console.log("[dev] SimC binary missing — building from source...");
    execSync("node scripts/build-simc.js", {
      cwd: path.join(__dirname, ".."),
      stdio: "inherit",
    });
  }

  // Fetch game data if missing
  if (!fs.existsSync(metadataFile)) {
    console.log("[dev] Game data missing — downloading from Raidbots...");
    await fetchGameData(dataDir);
  }

  console.log("[dev] Resources up to date.");
}

async function main() {
  // 0. Ensure game data and simc binary exist
  await ensureResources();

  // 1. Build backend if binary doesn't exist or any source changed
  if (!fs.existsSync(serverBinary)) {
    buildBackend();
  } else {
    // Rebuild if any .rs source file is newer than the binary
    try {
      const binaryMtime = fs.statSync(serverBinary).mtimeMs;
      const sourceChanged = findNewestMtime(BACKEND_DIR, ".rs") > binaryMtime
        || findNewestMtime(BACKEND_DIR, ".toml") > binaryMtime;
      if (sourceChanged) {
        buildBackend();
      } else {
        console.log("[dev] Backend binary up to date.");
      }
    } catch {
      buildBackend();
    }
  }

  // 2. Start Next.js dev server on a fixed port
  const FRONTEND_PORT = 3000;
  console.log(`[dev] Starting Next.js dev server on port ${FRONTEND_PORT}...`);
  const frontend = spawn("npx", ["next", "dev", "--port", String(FRONTEND_PORT)], {
    cwd: FRONTEND_DIR,
    stdio: "inherit",
    shell: true,
  });

  // 3. Wait for frontend to be ready
  console.log(`[dev] Waiting for frontend (localhost:${FRONTEND_PORT})...`);
  try {
    await waitForUrl(`http://localhost:${FRONTEND_PORT}`);
  } catch {
    console.error("[dev] Frontend did not start in time.");
    frontend.kill();
    process.exit(1);
  }
  console.log("[dev] Frontend ready.");

  // 4. Launch Electron
  console.log("[dev] Starting Electron...");
  const electronPath = require("electron");
  const electron = spawn(electronPath, [path.join(__dirname, "..")], {
    stdio: "inherit",
    env: process.env,
  });

  electron.on("exit", (code) => {
    console.log("[dev] Electron exited.");
    frontend.kill();
    process.exit(code ?? 0);
  });

  // Clean up on ctrl+c
  process.on("SIGINT", () => {
    electron.kill();
    frontend.kill();
    process.exit(0);
  });
  process.on("SIGTERM", () => {
    electron.kill();
    frontend.kill();
    process.exit(0);
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
