const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");

const backendDir = path.join(__dirname, "..", "..", "backend");
const resourcesDir = path.join(__dirname, "..", "resources");
const destDir = path.join(resourcesDir, "backend");

function copyDir(src, dest) {
  fs.mkdirSync(dest, { recursive: true });
  for (const entry of fs.readdirSync(src)) {
    const srcPath = path.join(src, entry);
    const destPath = path.join(dest, entry);
    if (fs.statSync(srcPath).isDirectory()) {
      copyDir(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
      // Preserve execute permissions (needed for simc/backend binaries on macOS/Linux)
      const mode = fs.statSync(srcPath).mode;
      fs.chmodSync(destPath, mode);
    }
  }
}

console.log("Building Rust backend with desktop feature...");
execSync("cargo build --release -p simhammer-server --features desktop", {
  cwd: backendDir,
  stdio: "inherit",
});

fs.mkdirSync(destDir, { recursive: true });

const ext = process.platform === "win32" ? ".exe" : "";
const binaryName = `simhammer-server${ext}`;
const src = path.join(backendDir, "target", "release", binaryName);
const dest = path.join(destDir, binaryName);

fs.copyFileSync(src, dest);
console.log(`Copied ${binaryName} to desktop/resources/backend/`);

// Copy game data files
const dataSrc = path.join(backendDir, "resources", "data");
const dataDest = path.join(resourcesDir, "data");
if (fs.existsSync(dataSrc)) {
  copyDir(dataSrc, dataDest);
  console.log("Copied game data to desktop/resources/data/");
} else {
  console.error("WARNING: backend/resources/data/ not found — backend will fail at startup");
}

// Copy simc binary
const simcSrc = path.join(backendDir, "resources", "simc");
const simcDest = path.join(resourcesDir, "simc");
if (fs.existsSync(simcSrc)) {
  copyDir(simcSrc, simcDest);
  console.log("Copied simc to desktop/resources/simc/");
} else {
  console.error("WARNING: backend/resources/simc/ not found — simulations will not work");
}
