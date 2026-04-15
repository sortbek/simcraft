const https = require("https");
const fs = require("fs");
const path = require("path");
const { execSync } = require("child_process");
const os = require("os");

const REPO = "sortbek/simc-builds";

const PLATFORM_ASSETS = {
  win32: "simc-windows-x64.zip",
  linux: "simc-linux-x64.tar.gz",
  darwin: "simc-macos-arm64.tar.gz",
};

const BINARY_NAME = process.platform === "win32" ? "simc.exe" : "simc";

// ── HTTP helpers ────────────────────────────────────────────────

function httpGet(url) {
  return new Promise((resolve, reject) => {
    https
      .get(url, { headers: { "User-Agent": "SimHammer" } }, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          return httpGet(res.headers.location).then(resolve, reject);
        }
        if (res.statusCode !== 200) {
          return reject(new Error(`HTTP ${res.statusCode} for ${url}`));
        }
        const chunks = [];
        res.on("data", (c) => chunks.push(c));
        res.on("end", () => resolve(Buffer.concat(chunks)));
        res.on("error", reject);
      })
      .on("error", reject);
  });
}

function httpGetWithProgress(url, onProgress) {
  return new Promise((resolve, reject) => {
    const request = (requestUrl) => {
      https
        .get(requestUrl, { headers: { "User-Agent": "SimHammer" } }, (res) => {
          if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
            return request(res.headers.location);
          }
          if (res.statusCode !== 200) {
            return reject(new Error(`HTTP ${res.statusCode} for ${requestUrl}`));
          }
          const total = parseInt(res.headers["content-length"] || "0", 10);
          let received = 0;
          const chunks = [];
          res.on("data", (chunk) => {
            chunks.push(chunk);
            received += chunk.length;
            if (onProgress && total > 0) {
              onProgress(received / total);
            }
          });
          res.on("end", () => resolve(Buffer.concat(chunks)));
          res.on("error", reject);
        })
        .on("error", reject);
    };
    request(url);
  });
}

// ── GitHub release queries ──────────────────────────────────────

/** Cache releases for 60s to avoid hammering the API */
let _releaseCache = null;
let _releaseCacheTime = 0;

async function fetchReleases() {
  if (_releaseCache && Date.now() - _releaseCacheTime < 60_000) return _releaseCache;
  const data = await httpGet(`https://api.github.com/repos/${REPO}/releases`);
  _releaseCache = JSON.parse(data.toString());
  _releaseCacheTime = Date.now();
  return _releaseCache;
}

async function getLatestRelease(prefix) {
  const releases = await fetchReleases();
  const asset = PLATFORM_ASSETS[process.platform];
  if (!asset) throw new Error(`Unsupported platform: ${process.platform}`);

  for (const release of releases) {
    if (!release.tag_name.startsWith(prefix)) continue;
    const match = release.assets.find((a) => a.name === asset);
    if (match) {
      return {
        tag: release.tag_name,
        type: prefix.replace("-", ""),
        assetUrl: match.browser_download_url,
      };
    }
  }
  return null;
}

function getLatestWeeklyRelease() {
  return getLatestRelease("weekly-");
}

function getLatestNightlyRelease() {
  return getLatestRelease("nightly-");
}

/**
 * Check for available updates (both weekly and nightly).
 * Returns available releases that aren't already installed.
 */
async function checkForUpdates(baseDir) {
  const installed = listInstalledVersions(baseDir);
  const installedTags = new Set(installed.map((v) => v.tag));

  const results = [];
  const errors = [];
  for (const fetcher of [getLatestWeeklyRelease, getLatestNightlyRelease]) {
    try {
      const release = await fetcher();
      if (release) {
        results.push({
          ...release,
          installed: installedTags.has(release.tag),
        });
      }
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
    }
  }

  if (results.length === 0 && errors.length > 0) {
    throw new Error(errors.join("; "));
  }
  return results;
}

// ── Multi-version directory management ──────────────────────────
//
// baseDir/
//   weekly-2026-04-12/simc[.exe]
//   nightly-2026-04-11/simc[.exe]
//   .active            (contains tag name of active version)

/**
 * List all installed simc versions.
 * @param {string} baseDir
 * @returns {{ tag: string, type: string, binaryPath: string }[]}
 */
function listInstalledVersions(baseDir) {
  if (!fs.existsSync(baseDir)) return [];
  const versions = [];
  for (const entry of fs.readdirSync(baseDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const binaryPath = path.join(baseDir, entry.name, BINARY_NAME);
    if (fs.existsSync(binaryPath)) {
      const tag = entry.name;
      const type = tag.startsWith("weekly-") ? "weekly" : tag.startsWith("nightly-") ? "nightly" : tag.startsWith("source-") ? "source" : "unknown";
      versions.push({ tag, type, binaryPath });
    }
  }
  // Sort newest first (tags are date-based so string sort works)
  versions.sort((a, b) => b.tag.localeCompare(a.tag));
  return versions;
}

function getActiveVersion(baseDir) {
  try {
    return fs.readFileSync(path.join(baseDir, ".active"), "utf-8").trim();
  } catch {
    return null;
  }
}

function setActiveVersion(baseDir, tag) {
  fs.mkdirSync(baseDir, { recursive: true });
  fs.writeFileSync(path.join(baseDir, ".active"), tag);
}

/**
 * Get the binary path of the currently active version.
 * @returns {string|null}
 */
function getActiveBinaryPath(baseDir) {
  const tag = getActiveVersion(baseDir);
  if (!tag) return null;
  const binaryPath = path.join(baseDir, tag, BINARY_NAME);
  return fs.existsSync(binaryPath) ? binaryPath : null;
}

function removeVersion(baseDir, tag) {
  const wasActive = getActiveVersion(baseDir) === tag;
  const dir = path.join(baseDir, tag);
  if (fs.existsSync(dir)) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  // If we just deleted the active version, promote the newest remaining install.
  if (wasActive) {
    const remaining = listInstalledVersions(baseDir);
    if (remaining.length > 0) {
      setActiveVersion(baseDir, remaining[0].tag);
    } else {
      try { fs.unlinkSync(path.join(baseDir, ".active")); } catch {}
    }
  }
}

// ── Download + extract ──────────────────────────────────────────

/**
 * Download and install a specific release.
 * @param {string} baseDir - Base simc directory
 * @param {{ tag: string, assetUrl: string }} release - Release info from getLatest*Release()
 * @param {(progress: number) => void} [onProgress]
 * @returns {Promise<string>} Path to the simc binary
 */
async function installVersion(baseDir, release, onProgress) {
  const versionDir = path.join(baseDir, release.tag);
  fs.mkdirSync(versionDir, { recursive: true });

  const asset = PLATFORM_ASSETS[process.platform];
  const tmpFile = path.join(os.tmpdir(), `simc-download-${Date.now()}-${asset}`);

  try {
    const data = await httpGetWithProgress(release.assetUrl, onProgress);
    fs.writeFileSync(tmpFile, data);

    if (asset.endsWith(".zip")) {
      execSync(
        `powershell -NoProfile -Command "Expand-Archive -Force -Path '${tmpFile}' -DestinationPath '${versionDir}'"`,
        { stdio: "ignore" }
      );
    } else {
      execSync(`tar xzf "${tmpFile}" -C "${versionDir}"`, { stdio: "ignore" });
    }

    const binaryPath = path.join(versionDir, BINARY_NAME);
    if (!fs.existsSync(binaryPath)) {
      throw new Error(`Extraction succeeded but ${BINARY_NAME} not found in ${versionDir}`);
    }

    if (process.platform !== "win32") {
      fs.chmodSync(binaryPath, 0o755);
    }

    // Remove older versions of the same branch (keep only the one we just installed)
    const branch = release.tag.startsWith("weekly-") ? "weekly-" : release.tag.startsWith("nightly-") ? "nightly-" : null;
    if (branch) {
      for (const v of listInstalledVersions(baseDir)) {
        if (v.tag !== release.tag && v.tag.startsWith(branch)) {
          console.log(`[simc] Removing old ${v.tag}`);
          removeVersion(baseDir, v.tag);
        }
      }
    }

    return binaryPath;
  } finally {
    try { fs.unlinkSync(tmpFile); } catch {}
  }
}

/**
 * Ensure simc is available. Downloads latest weekly if nothing installed.
 * Sets it as active. Used on startup.
 * @param {string} baseDir
 * @param {(progress: number) => void} [onProgress]
 * @returns {Promise<string>} Path to active simc binary
 */
async function ensureSimc(baseDir, onProgress) {
  // Migrate from old single-binary layout if needed
  migrateFromLegacy(baseDir);

  // If we have an active version, use it
  const activePath = getActiveBinaryPath(baseDir);
  if (activePath) return activePath;

  // If we have any installed versions, activate the newest
  const installed = listInstalledVersions(baseDir);
  if (installed.length > 0) {
    setActiveVersion(baseDir, installed[0].tag);
    return installed[0].binaryPath;
  }

  // Nothing installed — download latest weekly
  const release = await getLatestWeeklyRelease();
  if (!release) throw new Error("No weekly release found on sortbek/simc-builds");

  const binaryPath = await installVersion(baseDir, release, onProgress);
  setActiveVersion(baseDir, release.tag);
  return binaryPath;
}

/**
 * Migrate from old single-binary layout (simc[.exe] + .version in baseDir)
 * to the new versioned subdirectory layout.
 */
function migrateFromLegacy(baseDir) {
  const legacyBinary = path.join(baseDir, BINARY_NAME);
  const legacyVersion = path.join(baseDir, ".version");
  if (!fs.existsSync(legacyBinary)) return;

  let tag;
  try {
    tag = fs.readFileSync(legacyVersion, "utf-8").trim();
  } catch {
    tag = "weekly-legacy";
  }

  const versionDir = path.join(baseDir, tag);
  if (!fs.existsSync(versionDir)) {
    fs.mkdirSync(versionDir, { recursive: true });
    fs.renameSync(legacyBinary, path.join(versionDir, BINARY_NAME));
  }

  // Clean up legacy files
  try { fs.unlinkSync(legacyBinary); } catch {}
  try { fs.unlinkSync(legacyVersion); } catch {}

  if (!getActiveVersion(baseDir)) {
    setActiveVersion(baseDir, tag);
  }
}

module.exports = {
  ensureSimc,
  installVersion,
  listInstalledVersions,
  getActiveVersion,
  setActiveVersion,
  getActiveBinaryPath,
  removeVersion,
  checkForUpdates,
  getLatestWeeklyRelease,
  getLatestNightlyRelease,
  BINARY_NAME,
};
