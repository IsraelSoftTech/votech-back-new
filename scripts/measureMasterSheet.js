"use strict";
// Measures classMasterSheet as it exists now: fan-out fix + logo fix
// applied, but still builds one docDefinition for the whole class up
// front (unlike the report-card pipeline, this hasn't been chunked yet).
// doc.pipe(res) already means the RENDER step doesn't buffer the output,
// this measures whether the docDefinition-construction step alone is
// safe at scale or needs the same chunking treatment.
//
// Usage: DATABASE_URL=<local test db> node scripts/measureMasterSheet.js <classId> [academicYearId] [term]

const { Writable } = require("stream");
const { classMasterSheet } = require("../src/controllers/mastersheet.controller");

const CLASS_ID = Number(process.argv[2]);
const ACADEMIC_YEAR_ID = Number(process.argv[3]) || 1;
const TERM = process.argv[4] || "term3";

if (!CLASS_ID) {
  console.error("Usage: node scripts/measureMasterSheet.js <classId> [academicYearId] [term]");
  process.exit(1);
}

let peakRss = 0;
let peakHeap = 0;
const sampleInterval = setInterval(() => {
  const mem = process.memoryUsage();
  if (mem.rss > peakRss) peakRss = mem.rss;
  if (mem.heapUsed > peakHeap) peakHeap = mem.heapUsed;
}, 100);
const baselineRss = process.memoryUsage().rss;

function fakeReq() {
  return { query: { academicYearId: ACADEMIC_YEAR_ID, departmentId: 1, classId: CLASS_ID, term: TERM } };
}

function callAndWait(req) {
  return new Promise((resolve) => {
    let bytesWritten = 0;
    const res = new Writable({
      write(chunk, _enc, cb) {
        bytesWritten += chunk.length;
        cb();
      },
    });
    res.headersSent = false;
    res.setHeader = () => {};
    res.on("finish", () => resolve({ bytesWritten, err: null }));
    const next = (err) => resolve({ bytesWritten, err });
    classMasterSheet(req, res, next);
  });
}

(async () => {
  const start = Date.now();
  const result = await callAndWait(fakeReq());
  const durationMs = Date.now() - start;
  clearInterval(sampleInterval);

  if (result.err) {
    console.error("MEASUREMENT_FAILED", result.err.message);
    process.exit(1);
  }

  const report = {
    class_id: CLASS_ID,
    baseline_rss_mb: +(baselineRss / 1024 / 1024).toFixed(2),
    peak_rss_mb: +(peakRss / 1024 / 1024).toFixed(2),
    peak_rss_delta_mb: +((peakRss - baselineRss) / 1024 / 1024).toFixed(2),
    peak_heap_used_mb: +(peakHeap / 1024 / 1024).toFixed(2),
    response_size_mb: +(result.bytesWritten / 1024 / 1024).toFixed(2),
    duration_ms: durationMs,
  };
  console.log("MASTERSHEET_MEASUREMENT_RESULT " + JSON.stringify(report));
  process.exit(0);
})();
