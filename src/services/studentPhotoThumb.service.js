"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const { Jimp } = require("jimp");
const { pool } = require("../../routes/utils");

/** Table/list avatar — ~36px display, ultra-light JPEG */
const LIST_WIDTH = 48;
const LIST_HEIGHT = 48;
const LIST_QUALITY = 48;

/** ID card on-screen preview — light JPEG */
const CARD_WIDTH = 120;
const CARD_HEIGHT = 150;
const CARD_QUALITY = 68;

/** Downloaded ID card — sharp enough to print, still a small JPEG */
const PRINT_WIDTH = 360;
const PRINT_HEIGHT = 450;
const PRINT_QUALITY = 84;

const THUMB_DIR = path.join(__dirname, "../../local_uploads/student-thumbs");
const inflight = new Map();

function ensureThumbDir() {
  if (!fs.existsSync(THUMB_DIR)) {
    fs.mkdirSync(THUMB_DIR, { recursive: true });
  }
}

function normalizeSize(size) {
  const value = String(size || "list").toLowerCase();
  if (value === "print") return "print";
  if (value === "card") return "card";
  return "list";
}

function sizeConfig(size) {
  if (size === "print") {
    return { w: PRINT_WIDTH, h: PRINT_HEIGHT, q: PRINT_QUALITY };
  }
  if (size === "card") {
    return { w: CARD_WIDTH, h: CARD_HEIGHT, q: CARD_QUALITY };
  }
  return { w: LIST_WIDTH, h: LIST_HEIGHT, q: LIST_QUALITY };
}

function thumbCachePath(studentDbId, size = "list") {
  const s = normalizeSize(size);
  return path.join(THUMB_DIR, `${studentDbId}-${s}.jpg`);
}

/** Short stable id for the current photo file. A new upload gets a new id. */
function photoVersion(photoUrl) {
  const value = String(photoUrl || "").trim();
  if (!value) return null;
  return crypto.createHash("sha1").update(value).digest("hex").slice(0, 12);
}

function versionedThumbPath(studentDbId, size, version) {
  return path.join(
    THUMB_DIR,
    `${Number(studentDbId)}-${normalizeSize(size)}-${version}.jpg`
  );
}

function clearStudentPhotoThumbs(studentDbId) {
  ensureThumbDir();
  const id = Number(studentDbId);
  if (!id) return;
  const prefix = `${id}-`;
  for (const name of fs.readdirSync(THUMB_DIR)) {
    if (name === `${id}.jpg` || name.startsWith(prefix)) {
      fs.unlinkSync(path.join(THUMB_DIR, name));
    }
  }
  clearGenerationCooldown(id);
}

function readVersionedThumbBufferSync(studentDbId, size, photoUrl) {
  const id = Number(studentDbId);
  const version = photoVersion(photoUrl);
  if (!id || !version) return null;
  const file = versionedThumbPath(id, size, version);
  if (!fs.existsSync(file)) return null;
  return fs.readFileSync(file);
}

function legacyThumbCachePath(studentDbId) {
  return path.join(THUMB_DIR, `${studentDbId}.jpg`);
}

async function fetchImageBuffer(sourceUrl) {
  let lastError = null;
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    try {
      const response = await fetch(sourceUrl, { signal: controller.signal });
      if (!response.ok) {
        throw new Error(`Failed to fetch image (${response.status})`);
      }
      const arrayBuffer = await response.arrayBuffer();
      return Buffer.from(arrayBuffer);
    } catch (err) {
      lastError = err;
      if (attempt < 2) {
        await new Promise((resolve) => setTimeout(resolve, 400));
      }
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastError;
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

async function lookupPhotoUrl(studentDbId) {
  const id = Number(studentDbId);
  if (!id) return null;
  const { rows } = await pool.query(
    `SELECT photo_url FROM students WHERE id = $1 AND "deletedAt" IS NULL`,
    [id]
  );
  return rows[0]?.photo_url?.trim() || null;
}

const photoBuilds = new Map();

/**
 * One remote download fills list, card, and print files.
 * Parallel requests for the same photo share that single download.
 */
async function buildAllThumbsFromSource(studentDbId, photoUrl, version) {
  const id = Number(studentDbId);
  const source = String(photoUrl || "").trim();
  const ver = version || photoVersion(source);
  if (!id || !source || !ver) return null;

  const key = `${id}:${ver}`;
  if (photoBuilds.has(key)) return photoBuilds.get(key);

  const promise = (async () => {
    const sourceUrl = resolvePhotoUrl(source);
    if (!sourceUrl) return null;
    const sourceBuffer = await fetchImageBuffer(sourceUrl);
    const printBuffer = await resizeBuffer(sourceBuffer, "print");
    const cardBuffer = await resizeBuffer(sourceBuffer, "card");
    const listBuffer = await resizeBuffer(cardBuffer, "list");
    fs.writeFileSync(versionedThumbPath(id, "print", ver), printBuffer);
    fs.writeFileSync(versionedThumbPath(id, "card", ver), cardBuffer);
    fs.writeFileSync(versionedThumbPath(id, "list", ver), listBuffer);
    return { print: printBuffer, card: cardBuffer, list: listBuffer };
  })();

  photoBuilds.set(key, promise);
  try {
    return await promise;
  } finally {
    photoBuilds.delete(key);
  }
}

async function generateThumbFromPhotoUrl(studentDbId, size, photoUrl, version) {
  const built = await buildAllThumbsFromSource(studentDbId, photoUrl, version);
  if (!built) return null;
  return built[normalizeSize(size)] || null;
}

async function getStudentPhotoThumbImpl(
  studentDbId,
  { refresh = false, size = "list", allowGenerate = false } = {}
) {
  ensureThumbDir();
  const id = Number(studentDbId);
  if (!id) return null;

  const normalizedSize = normalizeSize(size);
  const photoUrl = await lookupPhotoUrl(id);
  if (!photoUrl) return null;

  const version = photoVersion(photoUrl);
  const cacheFile = versionedThumbPath(id, normalizedSize, version);

  if (refresh) {
    clearStudentPhotoThumbs(id);
  } else if (fs.existsSync(cacheFile)) {
    return fs.readFileSync(cacheFile);
  } else if (normalizedSize === "list") {
    const cardFile = versionedThumbPath(id, "card", version);
    if (fs.existsSync(cardFile)) {
      const thumbBuffer = await resizeBuffer(fs.readFileSync(cardFile), "list");
      fs.writeFileSync(cacheFile, thumbBuffer);
      return thumbBuffer;
    }
    if (!allowGenerate) return null;
  }

  return generateThumbFromPhotoUrl(id, normalizedSize, photoUrl, version);
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

async function generateThumbFromUploadBuffer(studentDbId, uploadBuffer, photoUrl) {
  ensureThumbDir();
  const id = Number(studentDbId);
  if (!id || !uploadBuffer?.length) return null;

  const source = String(photoUrl || "").trim() || (await lookupPhotoUrl(id));
  const version = photoVersion(source);
  if (!version) return null;

  // Drop every cached size first so a failed rebuild cannot keep the old face.
  clearStudentPhotoThumbs(id);

  try {
    const cardBuffer = await resizeBuffer(uploadBuffer, "card");
    const listBuffer = await resizeBuffer(cardBuffer, "list");
    const printBuffer = await resizeBuffer(uploadBuffer, "print");
    fs.writeFileSync(versionedThumbPath(id, "card", version), cardBuffer);
    fs.writeFileSync(versionedThumbPath(id, "list", version), listBuffer);
    fs.writeFileSync(versionedThumbPath(id, "print", version), printBuffer);
    return cardBuffer;
  } catch (err) {
    console.warn(`Upload thumb failed for student ${id}:`, err.message);
    return null;
  }
}

async function rebuildStudentThumbsFromFile(studentDbId, file, photoUrl) {
  if (!file || !String(photoUrl || "").trim()) return null;
  let bytes = file.buffer;
  if (!bytes?.length && file.path) {
    bytes = await fs.promises.readFile(file.path);
  }
  if (!bytes?.length) return null;
  return generateThumbFromUploadBuffer(studentDbId, bytes, photoUrl);
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

function thumbDataUri(buffer) {
  if (!buffer?.length) return null;
  return `data:image/jpeg;base64,${buffer.toString("base64")}`;
}

function readBestThumbDataUriSync(studentDbId, photoUrl, prefer = "list") {
  const source = String(photoUrl || "").trim();
  if (source) {
    const primary = readVersionedThumbBufferSync(studentDbId, prefer, source);
    if (primary) return thumbDataUri(primary);
    if (prefer === "list") {
      const card = readVersionedThumbBufferSync(studentDbId, "card", source);
      if (card) return thumbDataUri(card);
    }
    return null;
  }
  return prefer === "card"
    ? readCardThumbDataUriSync(studentDbId)
    : readListThumbDataUriSync(studentDbId);
}

function attachListThumbsToRows(rows = []) {
  return rows.map((row) => {
    const photoUrl = row.photo_url?.trim?.() ? row.photo_url : null;
    if (!row.has_photo && !photoUrl) return row;
    const thumb_src = readBestThumbDataUriSync(row.student_db_id, photoUrl, "list");
    if (!thumb_src) {
      return photoUrl || row.has_photo ? { ...row, has_photo: true } : row;
    }
    return { ...row, has_photo: true, thumb_src };
  });
}

const pendingGeneration = new Set();
/** Skip repeat FTP attempts for students that recently failed (ms). */
const failedGenerationUntil = new Map();
const GENERATION_COOLDOWN_MS = 6 * 60 * 60 * 1000;

function clearGenerationCooldown(studentDbId) {
  const id = Number(studentDbId);
  if (!id) return;
  const prefix = `${id}:`;
  for (const key of failedGenerationUntil.keys()) {
    if (key === id || String(key).startsWith(prefix)) {
      failedGenerationUntil.delete(key);
    }
  }
}

function shouldSkipGeneration(studentDbId, photoUrl) {
  const id = Number(studentDbId);
  if (!id) return true;
  if (photoUrl && readVersionedThumbBufferSync(id, "list", photoUrl)) return true;

  const until = failedGenerationUntil.get(`${id}:${photoVersion(photoUrl) || ""}`);
  if (until && until > Date.now()) return true;
  if (until && until <= Date.now()) {
    failedGenerationUntil.delete(`${id}:${photoVersion(photoUrl) || ""}`);
  }

  return false;
}

function markGenerationFailed(studentDbId, photoUrl) {
  const id = Number(studentDbId);
  if (!id) return;
  failedGenerationUntil.set(
    `${id}:${photoVersion(photoUrl) || ""}`,
    Date.now() + GENERATION_COOLDOWN_MS
  );
}

function queueThumbGeneration(ids = []) {
  const unique = [...new Set(ids.map((id) => Number(id)).filter(Boolean))];
  for (const id of unique) {
    if (pendingGeneration.has(id)) continue;

    pendingGeneration.add(id);
    setImmediate(async () => {
      try {
        const photoUrl = await lookupPhotoUrl(id);
        if (!photoUrl || shouldSkipGeneration(id, photoUrl)) return;
        const result = await getStudentPhotoThumb(id, {
          size: "card",
          allowGenerate: true,
        });
        if (!result) markGenerationFailed(id, photoUrl);
      } catch {
        markGenerationFailed(id);
      } finally {
        pendingGeneration.delete(id);
      }
    });
  }
}

/**
 * Build current-photo thumbnails for the given student rows.
 * Skips anyone whose cached file already matches photo_url.
 */
async function hydrateStudentPhotoThumbs(rows = [], { size = "card" } = {}) {
  const target = normalizeSize(size);
  const queue = [];
  for (const row of rows) {
    const photoUrl = row?.photo_url?.trim?.() ? row.photo_url.trim() : "";
    const id = Number(row?.student_db_id || row?.id);
    if (!photoUrl || !id) continue;
    if (readVersionedThumbBufferSync(id, target, photoUrl)) continue;
    // A small list/card file is not a substitute for the print photo.
    if (target !== "print" && shouldSkipGeneration(id, photoUrl)) continue;
    queue.push(id);
  }

  const pending = [...new Set(queue)];
  if (!pending.length) return;

  const workerCount = Math.min(target === "print" ? 3 : 4, pending.length);
  await Promise.all(
    Array.from({ length: workerCount }, async () => {
      while (pending.length) {
        const id = pending.shift();
        try {
          const result = await getStudentPhotoThumb(id, {
            size: target,
            allowGenerate: true,
          });
          if (!result && target !== "print") {
            const photoUrl = await lookupPhotoUrl(id);
            markGenerationFailed(id, photoUrl);
          }
        } catch (err) {
          console.warn(`Student photo refresh failed for ${id}:`, err.message);
          if (target !== "print") markGenerationFailed(id);
        }
      }
    })
  );
}

/** One-shot startup warmup — skips cached and recently failed IDs. */
async function warmupMissingThumbs({ batchSize = 3, maxPerRun = 40 } = {}) {
  ensureThumbDir();
  const { rows } = await pool.query(`
    SELECT id, photo_url
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
    if (shouldSkipGeneration(row.id, row.photo_url)) {
      skipped += 1;
      continue;
    }

    try {
      const result = await getStudentPhotoThumb(row.id, {
        size: "card",
        allowGenerate: true,
      });
      if (result) {
        built += 1;
      } else {
        markGenerationFailed(row.id, row.photo_url);
        skipped += 1;
      }
      if (built > 0 && built % batchSize === 0) {
        await new Promise((resolve) => setTimeout(resolve, 80));
      }
    } catch {
      markGenerationFailed(row.id, row.photo_url);
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
  rebuildStudentThumbsFromFile,
  hydrateStudentPhotoThumbs,
  warmupMissingThumbs,
  attachListThumbsToRows,
  queueThumbGeneration,
  readListThumbDataUriSync,
  readCardThumbDataUriSync,
  readBestThumbDataUriSync,
  thumbCachePath,
};
