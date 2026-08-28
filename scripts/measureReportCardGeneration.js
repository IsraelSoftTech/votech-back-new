"use strict";
// Measures actual peak RSS for generating one class's report cards with
// the new chunked generator. Everything runs in-process (no separate
// Chromium child process, unlike the old puppeteer path), so process.
// memoryUsage().rss is the whole, honest story here.
//
// Usage: DATABASE_URL=<local test db> node scripts/measureReportCardGeneration.js <classId> [academicYearId] [term]

const fs = require("fs");
const path = require("path");
const { generateClassReportCardsToFile, TEMP_DIR } = require("../src/utils/reportCardChunkedGenerator.util");

const CLASS_ID = Number(process.argv[2]);
const ACADEMIC_YEAR_ID = Number(process.argv[3]) || 1;
const TERM = process.argv[4] || "term3";

if (!CLASS_ID) {
  console.error("Usage: node scripts/measureReportCardGeneration.js <classId> [academicYearId] [term]");
  process.exit(1);
}

function tempDirBytes() {
  if (!fs.existsSync(TEMP_DIR)) return 0;
  let total = 0;
  for (const name of fs.readdirSync(TEMP_DIR)) {
    try {
      total += fs.statSync(path.join(TEMP_DIR, name)).size;
    } catch {
      // file could vanish mid-scan (a chunk just got merged/deleted), fine to skip
    }
  }
  return total;
}

let peakRss = 0;
let peakHeap = 0;
let peakDiskBytes = 0;
const sampleInterval = setInterval(() => {
  const mem = process.memoryUsage();
  if (mem.rss > peakRss) peakRss = mem.rss;
  if (mem.heapUsed > peakHeap) peakHeap = mem.heapUsed;
  const disk = tempDirBytes();
  if (disk > peakDiskBytes) peakDiskBytes = disk;
}, 100);

const baselineRss = process.memoryUsage().rss;

const trace = [];

(async () => {
  const start = Date.now();
  const result = await generateClassReportCardsToFile(
    ACADEMIC_YEAR_ID,
    CLASS_ID,
    TERM,
    (processed, total) => {
      const mem = process.memoryUsage();
      trace.push({ processed, total, rss_mb: +(mem.rss / 1024 / 1024).toFixed(1) });
    }
  );
  const durationMs = Date.now() - start;
  console.log("TRACE " + JSON.stringify(trace));
  clearInterval(sampleInterval);

  const stat = fs.statSync(result.filePath);
  const report = {
    class_id: CLASS_ID,
    total_students: result.totalStudents,
    baseline_rss_mb: +(baselineRss / 1024 / 1024).toFixed(2),
    peak_rss_mb: +(peakRss / 1024 / 1024).toFixed(2),
    peak_rss_delta_mb: +((peakRss - baselineRss) / 1024 / 1024).toFixed(2),
    peak_heap_used_mb: +(peakHeap / 1024 / 1024).toFixed(2),
    peak_temp_disk_mb: +(peakDiskBytes / 1024 / 1024).toFixed(2),
    final_pdf_size_mb: +(stat.size / 1024 / 1024).toFixed(2),
    duration_ms: durationMs,
  };

  console.log("MEASUREMENT_RESULT " + JSON.stringify(report));
  fs.unlink(result.filePath, () => {});
  process.exit(0);
})().catch((err) => {
  clearInterval(sampleInterval);
  console.error("MEASUREMENT_FAILED", err.message);
  console.error(err.stack);
  process.exit(1);
});
