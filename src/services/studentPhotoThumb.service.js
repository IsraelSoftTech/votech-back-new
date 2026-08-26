"use strict";

const fs = require("fs");
const path = require("path");
const { Jimp } = require("jimp");
const { pool } = require("../../routes/utils");

/** Table/list avatar — ~36px display, ultra-light JPEG */
const LIST_WIDTH = 48;
const LIST_HEIGHT = 48;
const LIST_QUALITY = 48;

/** ID card print — higher detail */
const CARD_WIDTH = 120;
const CARD_HEIGHT = 150;
const CARD_QUALITY = 68;

const THUMB_DIR = path.join(__dirname, "../../local_uploads/student-thumbs");
const inflight = new Map();

function ensureThumbDir() {
  if (!fs.existsSync(THUMB_DIR)) {
    fs.mkdirSync(THUMB_DIR, { recursive: true });
  }
}

function normalizeSize(size) {
  return String(size || "list").toLowerCase() === "card" ? "card" : "list";
}

function sizeConfig(size) {
  if (normalizeSize(size) === "card") {
    return { w: CARD_WIDTH, h: CARD_HEIGHT, q: CARD_QUALITY };
  }
  return { w: LIST_WIDTH, h: LIST_HEIGHT, q: LIST_QUALITY };
}

function thumbCachePath(studentDbId, size = "list") {
  const s = normalizeSize(size);
  return path.join(THUMB_DIR, `${studentDbId}-${s}.jpg`);
}

function legacyThumbCachePath(studentDbId) {
  return path.join(THUMB_DIR, `${studentDbId}.jpg`);
}

async function fetchImageBuffer(sourceUrl) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 6000);
  try {
    const response = await fetch(sourceUrl, { signal: controller.signal });
    if (!response.ok) {
      throw new Error(`Failed to fetch image (${response.status})`);
    }
    const arrayBuffer = await response.arrayBuffer();
    return Buffer.from(arrayBuffer);
  } finally {
    clearTimeout(timer);
  }
}

function resolvePhotoUrl(photoUrl) {
  if (!photoUrl) return null;
  if (photoUrl.startsWith("http")) return photoUrl;
  const base =
    process.env.FTP_PUBLIC_BASE_URL ||
    "https://st60307.ispot.cc/votechs7academygroup";
  return `${base.replace(/\/$/, "")}/${photoUrl.replace(/^\//, "")}`;
}

async function resizeBuffer(sourceBuffer, size) {
  const { w, h, q } = sizeConfig(size);
  const image = await Jimp.read(sourceBuffer);
  image.cover({ w, h });
  return image.getBuffer("image/jpeg", { quality: q });
}

async function readCachedThumb(studentDbId, size) {
  const cacheFile = thumbCachePath(studentDbId, size);
  if (fs.existsSync(cacheFile)) {
    return fs.readFileSync(cacheFile);
  }

  if (normalizeSize(size) === "card") {
    const legacy = legacyThumbCachePath(studentDbId);
    if (fs.existsSync(legacy)) {
      return fs.readFileSync(legacy);
    }
  }

  if (normalizeSize(size) === "list") {
    const cardFile = thumbCachePath(studentDbId, "card");
    const legacy = legacyThumbCachePath(studentDbId);
    const sourceFile = fs.existsSync(cardFile)
      ? cardFile
      : fs.existsSync(legacy)
        ? legacy
        : null;
    if (sourceFile) {
      const sourceBuffer = fs.readFileSync(sourceFile);
      const thumbBuffer = await resizeBuffer(sourceBuffer, "list");
      fs.writeFileSync(cacheFile, thumbBuffer);
      return thumbBuffer;
    }
  }

  return null;
}

async function generateThumbFromPhotoUrl(studentDbId, size) {
  const id = Number(studentDbId);
  const { rows } = await pool.query(
    `SELECT photo_url FROM students WHERE id = $1 AND "deletedAt" IS NULL`,
    [id]
  );
  if (!rows.length || !rows[0].photo_url?.trim()) return null;

  const sourceUrl = resolvePhotoUrl(rows[0].photo_url);
  if (!sourceUrl) return null;

  const sourceBuffer = await fetchImageBuffer(sourceUrl);
  const thumbBuffer = await resizeBuffer(sourceBuffer, size);
  fs.writeFileSync(thumbCachePath(id, size), thumbBuffer);

  if (normalizeSize(size) === "card") {
    const listBuffer = await resizeBuffer(thumbBuffer, "list");
    fs.writeFileSync(thumbCachePath(id, "list"), listBuffer);
    await pool
      .query(`UPDATE students SET photo_thumb_url = $1 WHERE id = $2`, [
        `students/photos/thumbs/${id}.jpg`,
        id,
      ])
      .catch(() => {});
  }

  return thumbBuffer;
}

async function getStudentPhotoThumbImpl(
  studentDbId,
  { refresh = false, size = "list", allowGenerate = false } = {}
) {
  ensureThumbDir();
  const id = Number(studentDbId);
  if (!id) return null;

  const normalizedSize = normalizeSize(size);
  const cacheFile = thumbCachePath(id, normalizedSize);

  if (!refresh) {
    const cached = await readCachedThumb(id, normalizedSize);
    if (cached) return cached;

    // Never block list-view HTTP requests on remote FTP downloads.
    if (normalizedSize === "list" && !allowGenerate) {
      return null;
    }
  } else if (fs.existsSync(cacheFile)) {
    fs.unlinkSync(cacheFile);
  }

  return generateThumbFromPhotoUrl(id, normalizedSize);
}

async function getStudentPhotoThumb(studentDbId, options = {}) {
  const size = normalizeSize(options.size);
  const allowGenerate = Boolean(options.allowGenerate);
  const key = `${studentDbId}-${size}-${options.refresh ? "r" : "c"}-${allowGenerate ? "g" : "n"}`;
  if (inflight.has(key)) {
    return inflight.get(key);
  }

  const promise = getStudentPhotoThumbImpl(studentDbId, { ...options, size, allowGenerate });
  inflight.set(key, promise);
  try {
    return await promise;
  } finally {
    inflight.delete(key);
  }
}

async function generateThumbFromUploadBuffer(studentDbId, uploadBuffer) {
  ensureThumbDir();
  const id = Number(studentDbId);
  if (!id || !uploadBuffer?.length) return null;

  try {
    const cardBuffer = await resizeBuffer(uploadBuffer, "card");
    fs.writeFileSync(thumbCachePath(id, "card"), cardBuffer);
    const listBuffer = await resizeBuffer(cardBuffer, "list");
    fs.writeFileSync(thumbCachePath(id, "list"), listBuffer);
    fs.writeFileSync(legacyThumbCachePath(id), cardBuffer);
    return cardBuffer;
  } catch (err) {
    console.warn(`Upload thumb failed for student ${id}:`, err.message);
    return null;
  }
}

/** Read cached list thumb from disk only — no network, no Jimp (for list API). */
function readListThumbBufferSync(studentDbId) {
  ensureThumbDir();
  const id = Number(studentDbId);
  if (!id) return null;

  const listPath = thumbCachePath(id, "list");
  if (fs.existsSync(listPath)) {
    return fs.readFileSync(listPath);
  }

  const cardPath = thumbCachePath(id, "card");
  if (fs.existsSync(cardPath)) {
    return fs.readFileSync(cardPath);
  }

  const legacy = legacyThumbCachePath(id);
  if (fs.existsSync(legacy)) {
    return fs.readFileSync(legacy);
  }

  return null;
}

function readListThumbDataUriSync(studentDbId) {
  const buffer = readListThumbBufferSync(studentDbId);
  if (!buffer?.length) return null;
  return `data:image/jpeg;base64,${buffer.toString("base64")}`;
}

function readCardThumbBufferSync(studentDbId) {
  ensureThumbDir();
  const id = Number(studentDbId);
  if (!id) return null;

  const cardPath = thumbCachePath(id, "card");
  if (fs.existsSync(cardPath)) {
    return fs.readFileSync(cardPath);
  }

  const legacy = legacyThumbCachePath(id);
  if (fs.existsSync(legacy)) {
    return fs.readFileSync(legacy);
  }

  const listPath = thumbCachePath(id, "list");
  if (fs.existsSync(listPath)) {
    return fs.readFileSync(listPath);
  }

  return null;
}

function readCardThumbDataUriSync(studentDbId) {
  const buffer = readCardThumbBufferSync(studentDbId);
  if (!buffer?.length) return null;
  return `data:image/jpeg;base64,${buffer.toString("base64")}`;
}

function attachListThumbsToRows(rows = []) {
  return rows.map((row) => {
    if (!row.has_photo) return row;
    const thumb_src = readListThumbDataUriSync(row.student_db_id);
    return thumb_src ? { ...row, thumb_src } : row;
  });
}

const pendingGeneration = new Set();
/** Skip repeat FTP attempts for students that recently failed (ms). */
const failedGenerationUntil = new Map();
const GENERATION_COOLDOWN_MS = 6 * 60 * 60 * 1000;

function shouldSkipGeneration(studentDbId) {
  const id = Number(studentDbId);
  if (!id) return true;
  if (readListThumbBufferSync(id)) return true;

  const until = failedGenerationUntil.get(id);
  if (until && until > Date.now()) return true;
  if (until && until <= Date.now()) failedGenerationUntil.delete(id);

  return false;
}

function markGenerationFailed(studentDbId) {
  const id = Number(studentDbId);
  if (!id) return;
  failedGenerationUntil.set(id, Date.now() + GENERATION_COOLDOWN_MS);
}

function queueThumbGeneration(ids = []) {
  const unique = [...new Set(ids.map((id) => Number(id)).filter(Boolean))];
  for (const id of unique) {
    if (pendingGeneration.has(id) || shouldSkipGeneration(id)) continue;

    pendingGeneration.add(id);
    setImmediate(async () => {
      try {
        const result = await getStudentPhotoThumb(id, {
          size: "list",
          allowGenerate: true,
        });
        if (!result) markGenerationFailed(id);
      } catch {
        markGenerationFailed(id);
      } finally {
        pendingGeneration.delete(id);
      }
    });
  }
}

/** One-shot startup warmup — skips cached and recently failed IDs. */
async function warmupMissingThumbs({ batchSize = 3, maxPerRun = 40 } = {}) {
  ensureThumbDir();
  const { rows } = await pool.query(`
    SELECT id
    FROM students
    WHERE "deletedAt" IS NULL
      AND photo_url IS NOT NULL
      AND TRIM(photo_url) <> ''
    ORDER BY id DESC
    LIMIT 300
  `);

  let built = 0;
  let skipped = 0;

  for (const row of rows) {
    if (built >= maxPerRun) break;
    if (shouldSkipGeneration(row.id)) {
      skipped += 1;
      continue;
    }

    try {
      const result = await getStudentPhotoThumb(row.id, {
        size: "list",
        allowGenerate: true,
      });
      if (result) {
        built += 1;
      } else {
        markGenerationFailed(row.id);
        skipped += 1;
      }
      if (built > 0 && built % batchSize === 0) {
        await new Promise((resolve) => setTimeout(resolve, 80));
      }
    } catch {
      markGenerationFailed(row.id);
      skipped += 1;
    }
  }

  if (built > 0 || skipped > 0) {
    console.log(
      `Student photo thumb warmup: ${built} built, ${skipped} skipped (cooldown/cache)`
    );
  }
  return { built, skipped };
}

module.exports = {
  LIST_WIDTH,
  LIST_HEIGHT,
  CARD_WIDTH,
  CARD_HEIGHT,
  getStudentPhotoThumb,
  generateThumbFromUploadBuffer,
  warmupMissingThumbs,
  attachListThumbsToRows,
  queueThumbGeneration,
  readListThumbDataUriSync,
  readCardThumbDataUriSync,
  thumbCachePath,
};
