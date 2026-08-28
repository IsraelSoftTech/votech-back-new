"use strict";
// Measures the CURRENTLY LIVE endpoint (/report-cards/bulk-pdfs-direct,
// bulkPdfDirect in reportCardPdfGenerator.js) as it exists right now:
// benefits from the fan-out query fix and the logo fix (both live in
// shared code), but still builds one docDefinition for the whole class
// and buffers the whole PDF via generatePdfBuffer, no chunking, no qpdf.
//
// Usage: DATABASE_URL=<local test db> node scripts/measureLiveBulkPdfDirect.js <classId> [academicYearId] [term]

const { bulkPdfDirect } = require("../src/controllers/reportCardPdfGenerator");

const CLASS_ID = Number(process.argv[2]);
const ACADEMIC_YEAR_ID = Number(process.argv[3]) || 1;
const TERM = process.argv[4] || "term3";

if (!CLASS_ID) {
  console.error("Usage: node scripts/measureLiveBulkPdfDirect.js <classId> [academicYearId] [term]");
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
  return {
    query: { academicYearId: ACADEMIC_YEAR_ID, departmentId: 1, classId: CLASS_ID, term: TERM },
    protocol: "http",
    get: () => "localhost:5000",
  };
}

function callAndWait(req) {
  return new Promise((resolve) => {
    let bodyLength = 0;
    const res = {
      setHeader() {},
      status(code) {
        this.statusCode = code;
        return this;
      },
      end(buf) {
        if (buf) bodyLength = buf.length;
        resolve({ statusCode: this.statusCode, bodyLength, err: null });
      },
      json(data) {
        resolve({ statusCode: this.statusCode, data, err: null });
      },
    };
    const next = (err) => resolve({ statusCode: err?.statusCode, err });
    bulkPdfDirect(req, res, next);
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
    response_pdf_size_mb: +(result.bodyLength / 1024 / 1024).toFixed(2),
    duration_ms: durationMs,
  };
  console.log("LIVE_MEASUREMENT_RESULT " + JSON.stringify(report));
  process.exit(0);
})();
