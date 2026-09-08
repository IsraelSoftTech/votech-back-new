"use strict";
// Benchmarks muhammara as a drop-in replacement for the qpdf join step,
// but at a scale qpdf was never tested at: merging every class's report
// card PDF for one term into a SINGLE whole-school file. Production never
// does this in one shot (runSessionExecutor in reportCardSession.controller.js
// deliberately stays one-class-at-a-time so a whole-school session costs no
// more peak memory than a single class), this script exists to answer "what
// would it cost if we did".
//
// Two phases are measured separately:
//   Phase A - render+qpdf-merge every class to its own final PDF, exactly
//             the existing generateClassReportCardsToFile path, unchanged.
//             This is NOT what's being evaluated, it's prep, but its
//             numbers are reported for context.
//   Phase B - take all those per-class final PDFs and join them into one
//             whole-school PDF via muhammara's createWriter/
//             appendPDFPagesFromPDF, instead of qpdf. This is the join
//             actually being measured against a 1GB budget.
//
// muhammara's PDF-writer calls are synchronous native (C++) calls, there is
// no async variant, unlike qpdf which runs as a child process and never
// blocks Node's event loop. Phase B also runs a 20ms heartbeat timer
// throughout to catch that: any heartbeat tick that fires late by more than
// a few ms means the merge call froze the event loop for that long, which
// matters for a server still trying to answer other requests while this runs.
//
// Usage: node --expose-gc scripts/measureWholeSchoolMuhammaraMerge.js [academicYearId] [term]

const fs = require("fs");
const path = require("path");
const os = require("os");
const crypto = require("crypto");
const { Worker } = require("worker_threads");
const muhammara = require("muhammara");
const models = require("../src/models/index.model");
const { generateClassReportCardsToFile, TEMP_DIR } = require("../src/utils/reportCardChunkedGenerator.util");

const TERM = process.argv[3] || "term3";

function mb(bytes) {
  return +(bytes / 1024 / 1024).toFixed(2);
}

function tempFilePath(prefix) {
  if (!fs.existsSync(TEMP_DIR)) fs.mkdirSync(TEMP_DIR, { recursive: true });
  return path.join(TEMP_DIR, `${prefix}-${crypto.randomBytes(6).toString("hex")}.pdf`);
}

// Background RSS/heap sampler, same shape as the existing measure*.js
// scripts in this folder (measureReportCardGeneration.js,
// measureLiveBulkPdfDirect.js), just factored so it can be started/stopped
// per phase instead of running for the whole process lifetime.
function startMemSampler(intervalMs = 100) {
  let peakRss = 0;
  let peakHeap = 0;
  const timer = setInterval(() => {
    const mem = process.memoryUsage();
    if (mem.rss > peakRss) peakRss = mem.rss;
    if (mem.heapUsed > peakHeap) peakHeap = mem.heapUsed;
  }, intervalMs);
  return {
    stop() {
      clearInterval(timer);
      return { peakRss, peakHeap };
    },
  };
}

// CPU sampler: process.cpuUsage() reports cumulative user+system microseconds
// since process start (or since the last call, when passed a previous
// reading), so diffing consecutive samples over the sampler interval gives
// an instantaneous "% of one core" reading.
function startCpuSampler(intervalMs = 100) {
  let last = process.cpuUsage();
  let lastT = Date.now();
  let peakPct = 0;
  let sumPct = 0;
  let n = 0;
  const timer = setInterval(() => {
    const now = process.cpuUsage();
    const t = Date.now();
    const userDiff = now.user - last.user;
    const sysDiff = now.system - last.system;
    const wallMicros = (t - lastT) * 1000;
    const pct = wallMicros > 0 ? ((userDiff + sysDiff) / wallMicros) * 100 : 0;
    if (pct > peakPct) peakPct = pct;
    sumPct += pct;
    n += 1;
    last = now;
    lastT = t;
  }, intervalMs);
  return {
    stop() {
      clearInterval(timer);
      return { peakPct: +peakPct.toFixed(1), avgPct: n ? +(sumPct / n).toFixed(1) : 0 };
    },
  };
}

// Event-loop-lag heartbeat: a 20ms setInterval that, on a healthy event
// loop, fires every ~20ms. A synchronous native call (muhammara's merge)
// blocks the whole thread, so ticks queue up and fire late, the gap between
// expected and actual fire time IS the blocked duration.
function startLagSampler(intervalMs = 20) {
  let last = Date.now();
  let maxLagMs = 0;
  const timer = setInterval(() => {
    const now = Date.now();
    const lag = now - last - intervalMs;
    if (lag > maxLagMs) maxLagMs = lag;
    last = now;
  }, intervalMs);
  return {
    stop() {
      clearInterval(timer);
      return { maxLagMs: Math.max(0, Math.round(maxLagMs)) };
    },
  };
}

async function main() {
  const academicYearArg = Number(process.argv[2]);
  const academicYear = academicYearArg
    ? await models.AcademicYear.findByPk(academicYearArg)
    : await models.AcademicYear.findOne({ where: { status: "active" } });

  if (!academicYear) throw new Error("No academic year found (pass one explicitly as argv[2])");

  const classes = await models.Class.findAll({ order: [["id", "ASC"]] });
  console.log(
    `[bench] academic year: ${academicYear.name} (id=${academicYear.id}), term=${TERM}, ${classes.length} classes total`
  );

  // ─── Phase A: per-class render+qpdf-merge, exactly the production path ──
  const phaseAMem = startMemSampler();
  const phaseAStart = Date.now();

  const classPdfPaths = [];
  let totalStudents = 0;
  let classesWithData = 0;
  let classesSkipped = 0;
  const perClass = [];

  for (const cls of classes) {
    const t0 = Date.now();
    try {
      const { filePath, totalStudents: n } = await generateClassReportCardsToFile(
        academicYear.id,
        cls.id,
        TERM
      );
      classPdfPaths.push(filePath);
      totalStudents += n;
      classesWithData += 1;
      perClass.push({ class_id: cls.id, name: cls.name, students: n, ms: Date.now() - t0 });
      console.log(`[bench] class ${cls.id} (${cls.name}): ${n} students, ${Date.now() - t0}ms`);
    } catch (err) {
      classesSkipped += 1;
      console.log(`[bench] class ${cls.id} (${cls.name}): skipped (${err.message})`);
    }
    if (global.gc) global.gc();
  }

  const phaseADurationMs = Date.now() - phaseAStart;
  const { peakRss: phaseAPeakRss, peakHeap: phaseAPeakHeap } = phaseAMem.stop();

  if (classPdfPaths.length === 0) {
    throw new Error(`No class produced report cards for ${TERM} in ${academicYear.name}, nothing to merge`);
  }

  console.log(
    `[bench] Phase A done: ${classesWithData} classes with data, ${classesSkipped} skipped, ${totalStudents} students total, ${phaseADurationMs}ms, peak RSS ${mb(phaseAPeakRss)}MB`
  );

  // ─── Phase B: whole-school join via muhammara, instead of qpdf ─────────
  const finalPath = tempFilePath("whole-school-final");

  const phaseBMem = startMemSampler();
  const phaseBCpu = startCpuSampler();
  const phaseBLag = startLagSampler();
  const phaseBStart = Date.now();

  let mergeError = null;
  try {
    await new Promise((resolve, reject) => {
      const worker = new Worker(path.join(__dirname, "_muhammaraMergeWorker.js"), {
        workerData: { classPdfPaths, finalPath },
      });
      worker.on("message", () => resolve());
      worker.on("error", reject);
      worker.on("exit", (code) => {
        if (code !== 0) reject(new Error(`merge worker exited with code ${code}`));
      });
    });
  } catch (err) {
    mergeError = err;
  }

  const phaseBDurationMs = Date.now() - phaseBStart;
  const { peakRss: phaseBPeakRss, peakHeap: phaseBPeakHeap } = phaseBMem.stop();
  const { peakPct: phaseBPeakCpu, avgPct: phaseBAvgCpu } = phaseBCpu.stop();
  const { maxLagMs } = phaseBLag.stop();

  if (mergeError) {
    console.error("[bench] muhammara merge FAILED:", mergeError.message);
  }

  let finalSizeBytes = 0;
  let finalPageCount = null;
  if (!mergeError && fs.existsSync(finalPath)) {
    finalSizeBytes = fs.statSync(finalPath).size;
    try {
      const reader = muhammara.createReader(finalPath);
      finalPageCount = reader.getPagesCount();
    } catch {
      // non-fatal, size alone is still useful
    }
  }

  const report = {
    academic_year: academicYear.name,
    term: TERM,
    classes_total: classes.length,
    classes_with_data: classesWithData,
    classes_skipped: classesSkipped,
    total_students: totalStudents,
    phase_a_render_and_per_class_qpdf_merge: {
      duration_ms: phaseADurationMs,
      peak_rss_mb: mb(phaseAPeakRss),
      peak_heap_used_mb: mb(phaseAPeakHeap),
    },
    phase_b_whole_school_muhammara_merge: {
      files_merged: classPdfPaths.length,
      duration_ms: phaseBDurationMs,
      peak_rss_mb: mb(phaseBPeakRss),
      peak_heap_used_mb: mb(phaseBPeakHeap),
      peak_cpu_pct_of_one_core: phaseBPeakCpu,
      avg_cpu_pct_of_one_core: phaseBAvgCpu,
      max_event_loop_lag_ms: maxLagMs,
      final_pdf_size_mb: mb(finalSizeBytes),
      final_pdf_page_count: finalPageCount,
      failed: !!mergeError,
      error: mergeError ? mergeError.message : null,
    },
  };

  console.log("MEASUREMENT_RESULT " + JSON.stringify(report, null, 2));

  for (const p of classPdfPaths) fs.unlink(p, () => {});
  fs.unlink(finalPath, () => {});

  process.exit(mergeError ? 1 : 0);
}

main().catch((err) => {
  console.error("MEASUREMENT_FAILED", err.message);
  console.error(err.stack);
  process.exit(1);
});
