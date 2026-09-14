"use strict";
// Worker-thread half of pdfMerge.util.js. qpdf's WebAssembly build exposes
// only its CLI, and running it (callMain) is a synchronous call that holds
// the thread for the whole merge, so it lives on its own worker thread and
// the server's event loop never notices. One worker per merge, never reused:
// the WASM instance's linear memory is released with the thread, so nothing
// lingers between report-card sessions.
//
// Two quirks of @jspawn/qpdf-wasm's Emscripten loader worth knowing:
//   - On Node >= 18 (where global fetch exists) it tries to fetch() the .wasm
//     from a file path and dies with "unknown scheme". instantiateWasm below
//     is the documented hook that takes over loading, reading the bytes off
//     disk ourselves.
//   - Its virtual filesystem is in-memory (MEMFS) unless a real directory is
//     mounted via NODEFS. Mounting is what keeps qpdf streaming file-to-file
//     instead of holding every input and the output in RAM, i.e. the whole
//     reason the merge cost stays flat regardless of how many students are
//     in the class (see measured numbers in pdfMerge.util.js).

const { workerData, parentPort } = require("worker_threads");
const fs = require("fs");
const path = require("path");

const WASM_PATH = require.resolve("@jspawn/qpdf-wasm/qpdf.wasm");
const createQpdf = require("@jspawn/qpdf-wasm/qpdf.js");

async function loadQpdf(stdoutLines, stderrLines) {
  return createQpdf({
    noInitialRun: true,
    // Without this, qpdf's own exit() would tear the runtime down after the
    // first command and callMain's return code would never reach us.
    noExitRuntime: true,
    instantiateWasm(imports, onSuccess) {
      WebAssembly.instantiate(fs.readFileSync(WASM_PATH), imports)
        .then((result) => onSuccess(result.instance, result.module))
        .catch((err) => {
          throw err;
        });
      return {};
    },
    // This build was compiled with print/printErr hard-bound to console, the
    // only capture hooks it honors are the per-character stdout/stderr
    // device callbacks (null = flush), so lines are reassembled here.
    stdout: lineCollector(stdoutLines),
    stderr: lineCollector(stderrLines),
  });
}

function lineCollector(lines) {
  let buf = "";
  return (charCode) => {
    if (charCode === null || charCode === 10) {
      if (buf) lines.push(buf);
      buf = "";
      return;
    }
    buf += String.fromCharCode(charCode);
  };
}

// Each distinct host directory gets its own mount point, so inputs and the
// output can live anywhere (they all sit in the report-card temp dir today,
// but nothing here should silently break if that changes).
function mountDirs(qpdf, hostPaths) {
  const mountByDir = new Map();
  let n = 0;
  const virtualPath = (hostPath) => {
    const dir = path.dirname(path.resolve(hostPath));
    if (!mountByDir.has(dir)) {
      const mountPoint = `/mnt${n++}`;
      qpdf.FS.mkdir(mountPoint);
      qpdf.FS.mount(qpdf.NODEFS, { root: dir }, mountPoint);
      mountByDir.set(dir, mountPoint);
    }
    return `${mountByDir.get(dir)}/${path.basename(hostPath)}`;
  };
  return hostPaths.map(virtualPath);
}

async function run() {
  const stdoutLines = [];
  const stderrLines = [];
  const qpdf = await loadQpdf(stdoutLines, stderrLines);
  const { op } = workerData;

  if (op === "version") {
    const code = qpdf.callMain(["--version"]);
    if (code !== 0) throw new Error(`qpdf --version exited ${code}: ${stderrLines.join("\n")}`);
    // First line is "<program> version 11.0.0"; the program name is whatever
    // Emscripten took from argv, so only the version part is kept.
    const m = /version\s+(\S+)/.exec(stdoutLines[0] || "");
    return { version: m ? m[1] : stdoutLines[0] || "(unknown)" };
  }

  if (op === "merge") {
    const { inputPaths, outputPath } = workerData;
    const [virtualOut, ...virtualInputs] = mountDirs(qpdf, [outputPath, ...inputPaths]);
    // Explicit "1-z" (all pages) after every file: without it qpdf tries to
    // read the NEXT filename as a page range for the previous one and fails
    // with "unexpected character" as soon as there are two inputs.
    const args = ["--empty", "--pages"];
    for (const v of virtualInputs) args.push(v, "1-z");
    args.push("--", virtualOut);
    const code = qpdf.callMain(args);
    // qpdf's documented exit codes: 0 success, 3 success with warnings (the
    // output is still valid), anything else is a real failure.
    if (code !== 0 && code !== 3) {
      throw new Error(`qpdf exited ${code}: ${stderrLines.join("\n") || "(no stderr)"}`);
    }
    return { warnings: code === 3 ? stderrLines : [] };
  }

  throw new Error(`Unknown pdfMerge worker op "${op}"`);
}

run()
  .then((result) => parentPort.postMessage({ ok: true, result }))
  .catch((err) => parentPort.postMessage({ ok: false, error: err && err.message ? err.message : String(err) }));
