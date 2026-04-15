const { spawn, execSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const os = require("os");

const BINARY_NAME = process.platform === "win32" ? "simc.exe" : "simc";
const SIMC_REPO = "https://github.com/simulationcraft/simc.git";

// ── Toolchain detection ────────────────────────────────────────

function commandExists(cmd) {
  try {
    execSync(process.platform === "win32" ? `where ${cmd}` : `which ${cmd}`, {
      stdio: "ignore",
    });
    return true;
  } catch {
    return false;
  }
}

/**
 * Check whether the build toolchain (git, make/cmake, C++ compiler) is available.
 * Linux/macOS use make (matching the original SimC build). Windows uses cmake.
 * @returns {{ available: boolean, missing: string[] }}
 */
function isBuildToolchainAvailable() {
  const missing = [];
  if (!commandExists("git")) missing.push("git");

  if (process.platform === "win32") {
    if (!commandExists("cmake")) missing.push("cmake");
    // CMake's "Visual Studio" generator finds MSVC via the registry,
    // so cl.exe does not need to be on PATH.
  } else {
    if (!commandExists("make")) missing.push("make");
    const hasCompiler = commandExists("g++") || commandExists("clang++");
    if (!hasCompiler) missing.push("C++ compiler (g++ or clang++)");
  }

  return { available: missing.length === 0, missing };
}

// ── Helpers ────────────────────────────────────────────────────

function sanitizeRef(gitRef) {
  return gitRef.replace(/\//g, "-");
}

function runCommand(cmd, args, cwd, onProgress) {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args, {
      cwd,
      stdio: ["ignore", "pipe", "pipe"],
      shell: process.platform === "win32",
    });

    let stderr = "";

    proc.stdout.on("data", (data) => {
      const line = data.toString().trim();
      if (line && onProgress) onProgress(line);
    });

    proc.stderr.on("data", (data) => {
      const line = data.toString().trim();
      stderr += data.toString();
      if (line && onProgress) onProgress(line);
    });

    proc.on("close", (code) => {
      if (code !== 0) {
        reject(
          new Error(
            `Command "${cmd} ${args.join(" ")}" exited with code ${code}\n${stderr}`
          )
        );
      } else {
        resolve();
      }
    });

    proc.on("error", reject);
  });
}

// ── Build ──────────────────────────────────────────────────────

/**
 * Clone and build SimC from source.
 * @param {string} baseDir - Base simc directory (e.g. backend/resources/simc)
 * @param {string} [gitRef="main"] - Git branch or tag to build
 * @param {(message: string) => void} [onProgress] - Progress callback
 * @returns {Promise<string>} Path to the built simc binary
 */
async function buildSimc(baseDir, gitRef = "HEAD", onProgress) {
  const { available, missing } = isBuildToolchainAvailable();
  if (!available) {
    throw new Error(
      `Build toolchain not found. Missing: ${missing.join(", ")}`
    );
  }

  const refSafe = sanitizeRef(gitRef);
  const tag = `source-${refSafe}`;
  const versionDir = path.join(baseDir, tag);
  const tmpDir = path.join(
    os.tmpdir(),
    `simc-build-${Date.now()}-${refSafe}`
  );

  const log = onProgress || (() => {});

  try {
    // 1. Clone
    log(`Cloning simulationcraft/simc (${gitRef})...`);
    execSync(`git clone --depth 1 ${SIMC_REPO} "${tmpDir}"`, { stdio: "inherit" });

    if (gitRef !== "HEAD") {
      log(`Checking out ${gitRef}...`);
      execSync(`git fetch --depth 1 origin ${gitRef} && git checkout FETCH_HEAD`, {
        cwd: tmpDir,
        stdio: "inherit",
      });
    }

    const jobs = Math.max(1, os.cpus().length);
    let builtBinary;

    if (process.platform === "win32") {
      // Windows: use cmake with MSVC (Visual Studio), matching pre-3.2.0 build
      log("Configuring with CMake (MSVC)...");
      execSync([
        `cmake -B build -G "Visual Studio 17 2022" -A x64`,
        `-DBUILD_GUI=OFF -DBUILD_TESTING=OFF`,
        `-DCMAKE_CXX_FLAGS_RELEASE="/O2 /Ob3 /GL /fp:fast /DNDEBUG"`,
        `-DCMAKE_EXE_LINKER_FLAGS_RELEASE="/LTCG"`,
      ].join(" "),
        { cwd: tmpDir, stdio: "inherit" }
      );

      log(`Building simc.exe (Release, optimized)...`);
      execSync(`cmake --build build --config Release --target simc`, {
        cwd: tmpDir,
        stdio: "inherit",
      });

      builtBinary = path.join(tmpDir, "build", "Release", BINARY_NAME);
      if (!fs.existsSync(builtBinary)) builtBinary = null;
    } else {
      // Linux/macOS: use make in engine/ (matches pre-3.2.0 build)
      log(`Building with make (${jobs} parallel jobs)...`);
      execSync(
        `make LTO=1 NO_DEBUG=1 OPENSSL=0 -j${jobs} OPTS="-ffast-math -fomit-frame-pointer"`,
        { cwd: path.join(tmpDir, "engine"), stdio: "inherit" }
      );

      builtBinary = path.join(tmpDir, "engine", "simc");
      if (!fs.existsSync(builtBinary)) builtBinary = null;
    }

    if (!builtBinary) {
      throw new Error(
        `Build succeeded but ${BINARY_NAME} not found in ${tmpDir}`
      );
    }

    // 5. Install to version directory
    fs.mkdirSync(versionDir, { recursive: true });
    const destBinary = path.join(versionDir, BINARY_NAME);
    fs.copyFileSync(builtBinary, destBinary);
    if (process.platform !== "win32") {
      fs.chmodSync(destBinary, 0o755);
    }

    // 6. Remove older source-* builds
    if (fs.existsSync(baseDir)) {
      for (const entry of fs.readdirSync(baseDir, { withFileTypes: true })) {
        if (
          entry.isDirectory() &&
          entry.name.startsWith("source-") &&
          entry.name !== tag
        ) {
          log(`Removing old ${entry.name}`);
          fs.rmSync(path.join(baseDir, entry.name), {
            recursive: true,
            force: true,
          });
        }
      }
    }

    // 7. Set as active
    fs.writeFileSync(path.join(baseDir, ".active"), tag);

    log(`SimC built successfully: ${tag}`);
    return destBinary;
  } finally {
    // Clean up clone directory
    if (fs.existsSync(tmpDir)) {
      try {
        fs.rmSync(tmpDir, { recursive: true, force: true });
      } catch {
        // Best-effort cleanup
      }
    }
  }
}

// ── CLI mode ───────────────────────────────────────────────────

if (require.main === module) {
  const args = process.argv.slice(2);
  let gitRef = "HEAD";
  let baseDir = path.join(__dirname, "..", "..", "backend", "resources", "simc");

  for (let i = 0; i < args.length; i++) {
    if ((args[i] === "--ref" || args[i] === "-r") && args[i + 1]) {
      gitRef = args[++i];
    } else if ((args[i] === "--dir" || args[i] === "-d") && args[i + 1]) {
      baseDir = path.resolve(args[++i]);
    } else if (args[i] === "--help" || args[i] === "-h") {
      console.log("Usage: build-simc.js [--ref <branch|tag>] [--dir <simc-dir>]");
      console.log("");
      console.log("Options:");
      console.log("  --ref, -r   Git branch, tag, or commit to build (default: HEAD)");
      console.log("  --dir, -d   Output directory (default: backend/resources/simc)");
      process.exit(0);
    }
  }

  console.log(`Building SimC from source (ref: ${gitRef}, dir: ${baseDir})`);

  const { available, missing } = isBuildToolchainAvailable();
  if (!available) {
    console.error(`Missing build tools: ${missing.join(", ")}`);
    process.exit(1);
  }

  buildSimc(baseDir, gitRef, (msg) => console.log(`  ${msg}`))
    .then((binaryPath) => {
      console.log(`\nDone! Binary: ${binaryPath}`);
    })
    .catch((err) => {
      console.error(`\nBuild failed: ${err.message}`);
      process.exit(1);
    });
}

module.exports = {
  buildSimc,
  isBuildToolchainAvailable,
  BINARY_NAME,
};
