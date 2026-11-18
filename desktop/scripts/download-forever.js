// Downloads the WoW Forever engine (simhammer-forever + data) from sortbek/forever-builds.
// Uses the releases/latest redirect and the latest/download URLs, not the GitHub API.
const https = require("https");
const fs = require("fs");
const path = require("path");
const os = require("os");
const { execSync } = require("child_process");

const REPO = "sortbek/forever-builds";
const ARM = process.arch === "arm64";
const PLATFORM_ASSETS = {
  win32: "simhammer-forever-windows-x64.zip",
  linux: ARM ? "simhammer-forever-linux-arm64.tar.gz" : "simhammer-forever-linux-x64.tar.gz",
  darwin: ARM ? "simhammer-forever-macos-arm64.tar.gz" : "simhammer-forever-macos-x64.tar.gz",
};
const BINARY_NAME = process.platform === "win32" ? "simhammer-forever.exe" : "simhammer-forever";
const TIMEOUT_MS = 20000;

function request(url, { follow = true, onProgress } = {}) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { headers: { "User-Agent": "SimHammer" } }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        res.resume();
        if (!follow) return resolve({ headers: res.headers, body: null });
        return request(res.headers.location, { follow, onProgress }).then(resolve, reject);
      }
      if (res.statusCode !== 200) {
        res.resume();
        return reject(new Error(`HTTP ${res.statusCode} for ${url}`));
      }
      const total = parseInt(res.headers["content-length"] || "0", 10);
      let received = 0;
      const chunks = [];
      res.on("data", (c) => {
        chunks.push(c);
        received += c.length;
        if (onProgress && total > 0) onProgress(received / total);
      });
      res.on("end", () => resolve({ headers: res.headers, body: Buffer.concat(chunks) }));
      res.on("error", reject);
    });
    req.setTimeout(TIMEOUT_MS, () => req.destroy(new Error(`timeout for ${url}`)));
    req.on("error", reject);
  });
}

// Only a real release tag: it becomes a folder name and part of an Expand-Archive command.
const TAG_PATTERN = /^forever-\d{8}-[0-9a-f]+$/;

function tagFromLocation(location) {
  const m = /\/releases\/tag\/([^/?#]+)/.exec(location || "");
  if (!m) return null;
  const tag = decodeURIComponent(m[1]);
  return TAG_PATTERN.test(tag) ? tag : null;
}

async function latestTag() {
  const res = await request(`https://github.com/${REPO}/releases/latest`, { follow: false });
  const tag = tagFromLocation(res.headers.location);
  if (!tag) throw new Error("no Forever release found");
  return tag;
}

function activeTag(baseDir) {
  try {
    const tag = fs.readFileSync(path.join(baseDir, ".active"), "utf8").trim();
    return tag && fs.existsSync(path.join(baseDir, tag, BINARY_NAME)) ? tag : null;
  } catch {
    return null;
  }
}

async function install(baseDir, tag, onProgress) {
  const asset = PLATFORM_ASSETS[process.platform];
  if (!asset) throw new Error(`no Forever build for ${process.platform}`);
  const dir = path.join(baseDir, tag);
  const tmpFile = path.join(os.tmpdir(), `forever-download-${Date.now()}-${asset}`);
  try {
    const { body } = await request(`https://github.com/${REPO}/releases/download/${tag}/${asset}`, { onProgress });
    fs.writeFileSync(tmpFile, body);
    fs.rmSync(dir, { recursive: true, force: true });
    fs.mkdirSync(dir, { recursive: true });
    if (asset.endsWith(".zip")) {
      execSync(
        `powershell -NoProfile -Command "Expand-Archive -Force -Path '${tmpFile}' -DestinationPath '${dir}'"`,
        { stdio: "ignore" }
      );
    } else {
      execSync(`tar xzf "${tmpFile}" -C "${dir}"`, { stdio: "ignore" });
    }
    const binary = path.join(dir, BINARY_NAME);
    if (!fs.existsSync(binary)) throw new Error(`${BINARY_NAME} not found after extracting ${asset}`);
    if (process.platform !== "win32") fs.chmodSync(binary, 0o755);
    fs.writeFileSync(path.join(baseDir, ".active"), tag);
    for (const entry of fs.readdirSync(baseDir, { withFileTypes: true })) {
      if (entry.isDirectory() && entry.name !== tag) {
        try {
          fs.rmSync(path.join(baseDir, entry.name), { recursive: true, force: true });
        } catch (err) {
          console.warn(`[forever] could not remove ${entry.name}: ${err.message}`);
        }
      }
    }
  } finally {
    try {
      fs.unlinkSync(tmpFile);
    } catch {}
  }
}

/** Writes or clears the marker that tells the backend Forever is switched off. */
function setDisabled(baseDir, disabled) {
  const marker = path.join(baseDir, ".disabled");
  try {
    if (disabled) {
      fs.mkdirSync(baseDir, { recursive: true });
      fs.writeFileSync(marker, "");
    } else {
      fs.rmSync(marker, { force: true });
    }
  } catch (err) {
    console.warn(`[forever] ${err.message}`);
  }
}

/** Installs or updates the engine. Forever is optional: failures are logged, never thrown.
 *  Switched off it installs nothing; with auto-update off an installed engine is left as it is. */
async function ensureForever(baseDir, { enabled = true, autoUpdate = true, onProgress } = {}) {
  setDisabled(baseDir, !enabled);
  if (!enabled) return null;
  try {
    fs.mkdirSync(baseDir, { recursive: true });
    const installed = activeTag(baseDir);
    const tag = installed && !autoUpdate ? installed : await latestTag();
    if (tag !== installed) {
      console.log(`[forever] installing ${tag}`);
      await install(baseDir, tag, onProgress);
    }
  } catch (err) {
    console.warn(`[forever] ${err.message}`);
  }
  const active = activeTag(baseDir);
  return active ? path.join(baseDir, active) : null;
}

module.exports = {
  ensureForever,
  install,
  latestTag,
  activeTag,
  setDisabled,
  tagFromLocation,
  BINARY_NAME,
};
