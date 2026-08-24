"use strict";

const fs = require("fs");
const path = require("path");
const { Jimp } = require("jimp");
const { pool } = require("../../routes/utils");

const THUMB_WIDTH = 120;
const THUMB_HEIGHT = 150;
const THUMB_QUALITY = 72;

const THUMB_DIR = path.join(__dirname, "../../local_uploads/student-thumbs");

function ensureThumbDir() {
  if (!fs.existsSync(THUMB_DIR)) {
    fs.mkdirSync(THUMB_DIR, { recursive: true });
  }
}

function thumbCachePath(studentDbId) {
  return path.join(THUMB_DIR, `${studentDbId}.jpg`);
}

async function fetchImageBuffer(sourceUrl) {
  const response = await fetch(sourceUrl);
  if (!response.ok) {
    throw new Error(`Failed to fetch image (${response.status})`);
  }
  const arrayBuffer = await response.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

function resolvePhotoUrl(photoUrl) {
  if (!photoUrl) return null;
  if (photoUrl.startsWith("http")) return photoUrl;
  const base =
    process.env.FTP_PUBLIC_BASE_URL ||
    "https://st60307.ispot.cc/votechs7academygroup";
  return `${base.replace(/\/$/, "")}/${photoUrl.replace(/^\//, "")}`;
}

async function buildThumbnailBuffer(sourceBuffer) {
  const image = await Jimp.read(sourceBuffer);
  image.cover({ w: THUMB_WIDTH, h: THUMB_HEIGHT });
  return image.getBuffer("image/jpeg", { quality: THUMB_QUALITY });
}

async function getStudentPhotoThumb(studentDbId, { refresh = false } = {}) {
  ensureThumbDir();
  const id = Number(studentDbId);
  if (!id) return null;

  const cacheFile = thumbCachePath(id);
  if (!refresh && fs.existsSync(cacheFile)) {
    return fs.readFileSync(cacheFile);
  }

  const { rows } = await pool.query(
    `SELECT photo_url, photo_thumb_url FROM students WHERE id = $1 AND "deletedAt" IS NULL`,
    [id]
  );
  if (!rows.length) return null;

  const row = rows[0];
  const sourceUrl =
    resolvePhotoUrl(row.photo_thumb_url) || resolvePhotoUrl(row.photo_url);
  if (!sourceUrl) return null;

  try {
    const sourceBuffer = await fetchImageBuffer(sourceUrl);
    const thumbBuffer = await buildThumbnailBuffer(sourceBuffer);
    fs.writeFileSync(cacheFile, thumbBuffer);

    if (!row.photo_thumb_url && row.photo_url) {
      await pool.query(
        `UPDATE students SET photo_thumb_url = $1 WHERE id = $2`,
        [`students/photos/thumbs/${id}.jpg`, id]
      ).catch(() => {});
    }

    return thumbBuffer;
  } catch (err) {
    console.warn(`Thumb generation failed for student ${id}:`, err.message);
    if (fs.existsSync(cacheFile)) {
      return fs.readFileSync(cacheFile);
    }
    return null;
  }
}

async function generateThumbFromUploadBuffer(studentDbId, uploadBuffer) {
  ensureThumbDir();
  const id = Number(studentDbId);
  if (!id || !uploadBuffer?.length) return null;

  try {
    const thumbBuffer = await buildThumbnailBuffer(uploadBuffer);
    fs.writeFileSync(thumbCachePath(id), thumbBuffer);
    return thumbBuffer;
  } catch (err) {
    console.warn(`Upload thumb failed for student ${id}:`, err.message);
    return null;
  }
}

module.exports = {
  THUMB_WIDTH,
  THUMB_HEIGHT,
  getStudentPhotoThumb,
  generateThumbFromUploadBuffer,
  thumbCachePath,
};
