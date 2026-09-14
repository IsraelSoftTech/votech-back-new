"use strict";
// Merges PDF files into one, file-to-file, using qpdf compiled to
// WebAssembly (@jspawn/qpdf-wasm). Replaces the external qpdf binary that
// used to be provisioned by scripts/ensureQpdf.js.
//
// Why this and not the binary or a JS library: the binary broke in prod
// (bin/qpdf/qpdf was committed without the executable bit, so every fresh
// checkout gave "spawn ... EACCES", and the self-heal path depended on a
// GitHub download from the VPS). The WASM build ships inside the npm
// package like any other JS file: no download, no compile, no chmod, no
// root, no dependency on which OS or Node build the VPS runs. It is the
// same qpdf with the same "--empty --pages ... --" invocation.
//
// Memory was benchmarked on real data (2026-09-12, 472 students / 26
// classes, largest class 95) as extra peak RSS above the process baseline:
//   qpdf-wasm   +32 MB largest class, +41 MB whole school in ONE file,
//               +68 MB at 4x whole school (1,888 students) -> flat-ish
//   pdf-lib     +41 MB / +89 MB / +257 MB -> linear in output size, because
//               PDFDocument.save() always builds the whole result in memory
//   muhammara   +27 MB flat, but it's a native addon whose install downloads
//               a prebuilt binary from GitHub (else compiles C++), the exact
//               failure class that broke qpdf, so rejected for deployment.
// The WASM instance's memory is an ArrayBuffer outside V8's heap, so it is
// not counted against --max-old-space-size either (see index.js).

const fs = require("fs");
const path = require("path");
const { Worker } = require("worker_threads");

const WORKER_PATH = path.join(__dirname, "pdfMerge.worker.js");

function runWorker(workerData) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(WORKER_PATH, { workerData });
    let settled = false;
    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      fn(value);
    };
    worker.on("message", (msg) => {
      if (msg && msg.ok) finish(resolve, msg.result);
      else finish(reject, new Error(msg && msg.error ? msg.error : "pdfMerge worker failed without a message"));
    });
    worker.on("error", (err) => finish(reject, err));
    // A clean exit after the result message is the normal path, finish()
    // is a no-op by then. Anything else means the worker died mid-merge.
    worker.on("exit", (code) =>
      finish(
        reject,
        new Error(code !== 0 ? `pdfMerge worker exited with code ${code}` : "pdfMerge worker exited before reporting a result")
      )
    );
  });
}

/**
 * Merges `inputPaths` (in order) into a single PDF at `outputPath`.
 * Inputs are left untouched; the caller owns their cleanup.
 *
 * @param {string[]} inputPaths
 * @param {string} outputPath
 * @returns {Promise<{ warnings: string[] }>}
 */
async function mergePdfFiles(inputPaths, outputPath) {
  if (!Array.isArray(inputPaths) || inputPaths.length === 0) {
    throw new Error("mergePdfFiles: no input files given");
  }
  for (const p of inputPaths) {
    if (!fs.existsSync(p)) throw new Error(`mergePdfFiles: input file missing: ${p}`);
  }
  fs.mkdirSync(path.dirname(path.resolve(outputPath)), { recursive: true });

  let result;
  try {
    result = await runWorker({ op: "merge", inputPaths, outputPath });
  } catch (err) {
    // Never leave a partial output behind for a caller to mistake for a
    // finished report-card file.
    fs.rmSync(outputPath, { force: true });
    throw new Error(`PDF merge failed: ${err.message}`);
  }
  if (!fs.existsSync(outputPath) || fs.statSync(outputPath).size === 0) {
    fs.rmSync(outputPath, { force: true });
    throw new Error("PDF merge failed: qpdf reported success but produced no output file");
  }
  for (const line of result.warnings || []) console.warn(`[pdfMerge] qpdf warning: ${line}`);
  return result;
}

/**
 * Boot-time self-test: loads the WASM module on a worker and asks it for
 * its version. Replaces the old qpdf watchdog. There is nothing to
 * re-provision any more (the engine is a file in node_modules), so a single
 * loud check at startup is the right shape: if this fails, report cards
 * will fail, and the log says so before anyone starts a session.
 *
 * @returns {Promise<string>} the qpdf version string
 */
async function verifyPdfMergeEngine() {
  const { version } = await runWorker({ op: "version" });
  return version;
}

module.exports = { mergePdfFiles, verifyPdfMergeEngine };
