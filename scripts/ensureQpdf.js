"use strict";
// Provisions a local, project-owned qpdf binary (used to merge report-card
// chunk PDFs without pdf-lib's in-memory-only merge, see
// reportCardChunkedGenerator.util.js for why). Runs automatically on
// `npm install` via the postinstall hook, no manual/root install step, no
// system package manager involved. Downloads the OFFICIAL prebuilt binary
// directly from qpdf's own GitHub releases (not a third-party wrapper,
// see the qpdf-compress dead end this replaced), verifies it against a
// pinned SHA256 before ever extracting or executing anything, and skips
// entirely if already present AND working (see verifyQpdfWorks), safe to
// re-run on every deploy. Also called at server startup and on a periodic
// timer (see index.js) so a corrupted/missing binary self-heals without
// needing a manual redeploy or restart, not just a fresh `npm install`.

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const https = require("https");
const { execFileSync } = require("child_process");

const QPDF_VERSION = "12.4.0";
const INSTALL_DIR = path.join(__dirname, "..", "bin", "qpdf");

// Pinned directly from GitHub's release API for this exact version, not
// copied off a webpage, see the digest field on the release assets.
const TARGETS = {
  // Verified by actually extracting each zip and inspecting it, not
  // guessed by analogy, the two platforms don't share a layout: the
  // Linux build is dynamically linked against a bundled lib/ directory
  // (libqpdf + several system libs), the Windows build is one exe plus
  // a single companion DLL, both sitting under a top-level folder.
  linux: {
    url: `https://github.com/qpdf/qpdf/releases/download/v${QPDF_VERSION}/qpdf-${QPDF_VERSION}-bin-linux-x86_64.zip`,
    sha256: "a3bca240f3bb61efdc3a90be89d1da4ed5e125326c3458c4e62df53ff4f153e3",
    binaryInZip: "bin/qpdf",
    libDirInZip: "lib",
    finalBinaryName: "qpdf",
  },
  win32: {
    url: `https://github.com/qpdf/qpdf/releases/download/v${QPDF_VERSION}/qpdf-${QPDF_VERSION}-msvc64.zip`,
    sha256: "5bcb25353f7e6df92b5625dbcfe52a5c34a2a5fba2d1a8b98b8a6a0972c3ff72",
    binaryInZip: `qpdf-${QPDF_VERSION}-msvc64/bin/qpdf.exe`,
    extraFilesInZip: [`qpdf-${QPDF_VERSION}-msvc64/bin/qpdf30.dll`],
    finalBinaryName: "qpdf.exe",
  },
};

function getBinaryPath() {
  const target = TARGETS[process.platform];
  if (!target) return null;
  return path.join(INSTALL_DIR, target.finalBinaryName);
}

// Linux qpdf needs its bundled lib/ directory on the loader path, it's
// not statically linked. Returns null on platforms that don't need this
// (Windows resolves its one companion DLL by sitting next to the exe).
function getLibDir() {
  if (process.platform !== "linux") return null;
  const libDir = path.join(INSTALL_DIR, "lib");
  return fs.existsSync(libDir) ? libDir : null;
}

function download(url, destPath) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(destPath);
    https
      .get(url, { headers: { "User-Agent": "votech-report-cards" } }, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          file.close();
          fs.unlink(destPath, () => {});
          return resolve(download(res.headers.location, destPath));
        }
        if (res.statusCode !== 200) {
          file.close();
          fs.unlink(destPath, () => {});
          return reject(new Error(`Download failed: HTTP ${res.statusCode} for ${url}`));
        }
        res.pipe(file);
        file.on("finish", () => file.close(resolve));
      })
      .on("error", (err) => {
        fs.unlink(destPath, () => {});
        reject(err);
      });
  });
}

function sha256Of(filePath) {
  const hash = crypto.createHash("sha256");
  hash.update(fs.readFileSync(filePath));
  return hash.digest("hex");
}

// Existence alone isn't proof qpdf still works: a partial deploy, a
// container/ephemeral-disk event, or a permissions reset can all leave the
// file sitting at binaryPath but unable to run (spawn ENOENT/EACCES, or the
// Linux build finding its bundled lib/ directory gone). This is what let
// "already present" silently keep trusting a broken install indefinitely,
// see ensureQpdf()'s fast path below, actually running `--version` is the
// only real check.
function verifyQpdfWorks(binaryPath) {
  if (!fs.existsSync(binaryPath)) return false;
  try {
    const libDir = getLibDir();
    const env = libDir
      ? { ...process.env, LD_LIBRARY_PATH: [libDir, process.env.LD_LIBRARY_PATH].filter(Boolean).join(":") }
      : process.env;
    execFileSync(binaryPath, ["--version"], { env, stdio: ["ignore", "ignore", "ignore"] });
    return true;
  } catch {
    return false;
  }
}

async function ensureQpdf() {
  const target = TARGETS[process.platform];
  if (!target) {
    console.warn(
      `[ensureQpdf] Unsupported platform "${process.platform}", mass report-card generation will fall back to failing loudly instead of silently, this is expected in local dev on an unlisted OS.`
    );
    return;
  }

  const binaryPath = path.join(INSTALL_DIR, target.finalBinaryName);
  if (verifyQpdfWorks(binaryPath)) {
    console.log(`[ensureQpdf] Already present and working at ${binaryPath}, skipping.`);
    return;
  }
  if (fs.existsSync(binaryPath)) {
    console.warn(
      `[ensureQpdf] Found at ${binaryPath} but it failed to run (corrupted install, missing lib/ deps, or bad permissions), re-provisioning.`
    );
    // Only remove this platform's own files, INSTALL_DIR is shared by both
    // platforms' committed artifacts (this repo carries prebuilt binaries
    // for both Windows dev machines and the Linux VPS side by side), a
    // blanket rmSync(INSTALL_DIR) here would also delete the other
    // platform's untouched, perfectly fine files as collateral damage.
    fs.rmSync(binaryPath, { force: true });
    for (const extra of target.extraFilesInZip || []) {
      fs.rmSync(path.join(INSTALL_DIR, path.basename(extra)), { force: true });
    }
    if (target.libDirInZip) {
      fs.rmSync(path.join(INSTALL_DIR, "lib"), { recursive: true, force: true });
    }
  }

  fs.mkdirSync(INSTALL_DIR, { recursive: true });
  const zipPath = path.join(INSTALL_DIR, "_download.zip");
  const extractDir = path.join(INSTALL_DIR, "_extract");
  const cleanupTemp = () => {
    fs.rmSync(zipPath, { force: true });
    fs.rmSync(extractDir, { recursive: true, force: true });
  };

  try {
    console.log(`[ensureQpdf] Downloading qpdf ${QPDF_VERSION} for ${process.platform}...`);
    await download(target.url, zipPath);

    const actualHash = sha256Of(zipPath);
    if (actualHash !== target.sha256) {
      throw new Error(
        `[ensureQpdf] Checksum mismatch, refusing to extract/run an unverified download. Expected ${target.sha256}, got ${actualHash}.`
      );
    }
    console.log("[ensureQpdf] Checksum verified.");

    fs.mkdirSync(extractDir, { recursive: true });

    // extract-zip is pure JS (yauzl under the hood), no native compile
    // step, deliberately avoiding the exact "team needs extra tooling"
    // problem this whole script exists to solve.
    const extract = require("extract-zip");
    await extract(zipPath, { dir: extractDir });

    const filesToCopy = [target.binaryInZip, ...(target.extraFilesInZip || [])];
    for (const relPath of filesToCopy) {
      const src = path.join(extractDir, relPath);
      const dest = path.join(INSTALL_DIR, path.basename(relPath));
      fs.copyFileSync(src, dest);
    }

    if (target.libDirInZip) {
      const srcLibDir = path.join(extractDir, target.libDirInZip);
      const destLibDir = path.join(INSTALL_DIR, "lib");
      fs.cpSync(srcLibDir, destLibDir, { recursive: true, dereference: true });
    }

    if (process.platform !== "win32") {
      fs.chmodSync(binaryPath, 0o755);
    }
  } catch (err) {
    // Never leave a half-installed binary sitting at the path future
    // runs check for "already present", that would make every
    // subsequent run silently trust a broken install.
    fs.rmSync(binaryPath, { force: true });
    cleanupTemp();
    throw err;
  }
  cleanupTemp();

  const verifyLibDir = getLibDir();
  const verifyEnv = verifyLibDir
    ? { ...process.env, LD_LIBRARY_PATH: [verifyLibDir, process.env.LD_LIBRARY_PATH].filter(Boolean).join(":") }
    : process.env;
  const version = execFileSync(binaryPath, ["--version"], { env: verifyEnv }).toString().trim();
  console.log(`[ensureQpdf] Installed and verified working: ${version}`);
}

// Catches the "ran for a long time, then it started failing" case, which a
// startup-only check can't: something (a disk event, a permissions change,
// anything short of the process itself dying) corrupts or removes the
// binary mid-uptime, and nothing re-checks it again until the next
// restart, which on a long-lived VPS process could be weeks away. Same
// start-once-then-setInterval shape as startWatchdog/startReportCardWatchdog
// in src/controllers, see index.js for where this is called.
const QPDF_HEALTHCHECK_INTERVAL_MS =
  Number(process.env.QPDF_HEALTHCHECK_INTERVAL_MS) || 6 * 60 * 60 * 1000; // 6h

let qpdfWatchdogStarted = false;
function startQpdfWatchdog() {
  if (qpdfWatchdogStarted) return;
  qpdfWatchdogStarted = true;
  const tick = () => {
    ensureQpdf().catch((err) => {
      console.error("[ensureQpdf] Health check / re-provision failed:", err.message);
    });
  };
  tick();
  const timer = setInterval(tick, QPDF_HEALTHCHECK_INTERVAL_MS);
  if (timer.unref) timer.unref();
}

module.exports = {
  ensureQpdf,
  verifyQpdfWorks,
  startQpdfWatchdog,
  getBinaryPath,
  getLibDir,
  INSTALL_DIR,
};

if (require.main === module) {
  ensureQpdf().catch((err) => {
    console.error("[ensureQpdf] Failed:", err.message);
    process.exit(1);
  });
}
