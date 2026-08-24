"use strict";

// Generates one class's report-card PDF without ever holding the whole
// class's rendered content in memory at once.
//
// Why chunked-then-merged instead of one pass: pdfmake needs a complete
// docDefinition up front, it can't accept pages incrementally the way raw
// pdfkit can, that's what let the old code build one docDefinition for an
// entire class (hundreds of students) before rendering a single byte.
// Splitting into small per-chunk documents, each streamed to its own temp
// file, bounds the RENDER step to "one chunk's worth of students"
// regardless of class size.
//
// The merge step used to go through pdf-lib, measured at 1000 students:
// ~949MB peak RSS, over a 1GB VPS's entire budget. Root cause, confirmed
// against pdf-lib's own issue tracker: PDFDocument.save() always
// buffers the whole merged document in memory before returning bytes,
// there is no streaming save, regardless of what the options suggest.
// qpdf (a real external process, memory outside Node's heap entirely,
// see scripts/ensureQpdf.js for how it's provisioned) merges file-to-file
// without that ceiling.

const fs = require("fs");
const path = require("path");
const os = require("os");
const crypto = require("crypto");
const { execFile } = require("child_process");
const { getBinaryPath, getLibDir } = require("../../scripts/ensureQpdf");
const models = require("../models/index.model");
const {
  buildReportCardsFromMarks,
  attachAcademicRemarks,
} = require("../controllers/reportCard.controller");
const {
  printer,
  buildDocDefinition,
  prepareGrading,
  loadLogoBase64,
  termKeyToLabel,
  resolveTermKey,
  fetchMarksWithIncludes,
} = require("../controllers/reportCardPdfGenerator");

const CHUNK_SIZE = Number(process.env.REPORT_CARD_CHUNK_SIZE) || 25;
const CHUNK_YIELD_MS = 15;

const TEMP_DIR = process.env.REPORT_CARD_TEMP_DIR || path.join(os.tmpdir(), "report-card-gen");

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function ensureTempDir() {
  if (!fs.existsSync(TEMP_DIR)) {
    fs.mkdirSync(TEMP_DIR, { recursive: true });
  }
}

function tempFilePath(prefix) {
  return path.join(TEMP_DIR, `${prefix}-${crypto.randomBytes(6).toString("hex")}.pdf`);
}

function renderChunkToFile(chunkCards, termLabel, gradingScale, logoBase64) {
  return new Promise((resolve, reject) => {
    const filePath = tempFilePath("chunk");
    try {
      const docDef = buildDocDefinition(chunkCards, termLabel, gradingScale, logoBase64);
      const doc = printer.createPdfKitDocument(docDef);
      const stream = fs.createWriteStream(filePath);
      doc.on("error", (err) => {
        stream.destroy();
        reject(err);
      });
      stream.on("error", reject);
      stream.on("finish", () => resolve(filePath));
      doc.pipe(stream);
      doc.end();
    } catch (err) {
      reject(err);
    }
  });
}

// Merges the chunk PDFs into one final file via qpdf (a real external
// process, its memory lives outside Node's heap entirely), instead of
// pdf-lib, which always builds the whole merged document in memory
// before it can write anything, see the file header for the measured
// numbers behind this.
function mergeChunksToFile(chunkPaths, finalPath) {
  return new Promise((resolve, reject) => {
    const qpdfPath = getBinaryPath();
    if (!qpdfPath || !fs.existsSync(qpdfPath)) {
      return reject(
        new Error(
          "qpdf binary not found, run `node scripts/ensureQpdf.js` (also wired into npm postinstall) before generating report cards."
        )
      );
    }

    // Linux's qpdf build is dynamically linked against its own bundled
    // lib/ directory (libqpdf + a few system libs), not statically
    // linked, it won't find them without this. No-op on Windows, where
    // the one companion DLL just sits next to the exe already.
    const libDir = getLibDir();
    const env = libDir
      ? { ...process.env, LD_LIBRARY_PATH: [libDir, process.env.LD_LIBRARY_PATH].filter(Boolean).join(":") }
      : process.env;

    const args = ["--empty", "--pages", ...chunkPaths, "--", finalPath];
    execFile(qpdfPath, args, { env }, (err, _stdout, stderr) => {
      // qpdf's own docs: exit code 3 means "succeeded with warnings"
      // (e.g. a minor structural quirk in an input), the output is still
      // valid, only exit codes >= 2 other than 3 are real failures.
      if (err && err.code !== 3) {
        return reject(new Error(`qpdf merge failed: ${stderr || err.message}`));
      }
      for (const p of chunkPaths) fs.unlink(p, () => {});
      resolve();
    });
  });
}

/**
 * Generates one class's report cards to a local temp PDF file, streamed
 * and chunked throughout. Caller is responsible for uploading the
 * returned file and deleting it afterward.
 *
 * @param {number} academicYearId
 * @param {number} classId
 * @param {string} term - "term1" | "term2" | "term3" | "annual"
 * @param {(processed: number, total: number) => void} [onProgress]
 * @returns {Promise<{ filePath: string, totalStudents: number }>}
 */
const DEBUG_MEM = process.env.REPORT_CARD_DEBUG_MEM === "1";
function logMem(label) {
  if (!DEBUG_MEM) return;
  const mb = (process.memoryUsage().rss / 1024 / 1024).toFixed(1);
  console.log(`[mem] ${label}: ${mb} MB RSS`);
}

async function generateClassReportCardsToFile(academicYearId, classId, term, onProgress) {
  ensureTempDir();
  logMem("start");

  const [academicYear, studentClass, termKey] = await Promise.all([
    models.AcademicYear.findByPk(academicYearId),
    models.Class.findByPk(classId, {
      include: [{ model: models.User, as: "classMaster", attributes: ["name", "username"] }],
    }),
    resolveTermKey(term, academicYearId),
  ]);

  if (!academicYear) throw new Error("Academic year not found");
  if (!studentClass) throw new Error("Class not found");

  const [marks, gradingRaw] = await Promise.all([
    fetchMarksWithIncludes(academicYearId, classId),
    models.AcademicBand.findAll({
      where: { academic_year_id: academicYear.id, class_id: studentClass.id },
      raw: true,
    }),
  ]);
  logMem(`after marks query (${marks.length} rows)`);

  if (!marks.length) {
    throw new Error(`No marks found for ${studentClass.name}`);
  }

  const classMaster =
    studentClass?.classMaster?.name || studentClass?.classMaster?.username || "";
  const termLabel = termKeyToLabel(termKey);

  // The one whole-class-scope step: ranks and class stats are inherently
  // relative to every student in the class, there is no way to compute a
  // rank without seeing everyone. This is why the query above still fetches
  // the whole class rather than being chunked itself, raw+nest keeps that
  // affordable (see fetchMarksWithIncludes), chunking below is only for
  // the render step, which is the part that scales badly per student.
  const cards = buildReportCardsFromMarks(marks, classMaster, termKey);
  logMem("after buildReportCardsFromMarks");
  await attachAcademicRemarks(cards, academicYearId, classId, termKey);
  const gradingScale = prepareGrading(gradingRaw);
  const logoBase64 = loadLogoBase64();
  logMem("after grading+logo load");

  const chunkPaths = [];
  let processed = 0;
  try {
    for (let i = 0; i < cards.length; i += CHUNK_SIZE) {
      const chunk = cards.slice(i, i + CHUNK_SIZE);
      const chunkPath = await renderChunkToFile(chunk, termLabel, gradingScale, logoBase64);
      chunkPaths.push(chunkPath);
      processed += chunk.length;
      if (onProgress) onProgress(processed, cards.length);
      // Give V8 a chance to actually reclaim the chunk we just finished
      // with before starting the next one, when running under --expose-gc
      // (measurement only, harmless no-op otherwise).
      if (global.gc) global.gc();
      await sleep(CHUNK_YIELD_MS);
    }

    const finalPath = tempFilePath("final");
    await mergeChunksToFile(chunkPaths, finalPath);
    return { filePath: finalPath, totalStudents: cards.length };
  } catch (err) {
    for (const p of chunkPaths) fs.unlink(p, () => {});
    throw err;
  }
}

module.exports = { generateClassReportCardsToFile, TEMP_DIR };
