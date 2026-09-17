"use strict";

/**
 * Point 8 — User Guide Module.
 *
 * Admin3 is the only role that may create, edit, publish or delete a guide.
 * Every other authenticated role gets a read-only view, limited to the guides
 * whose target roles include their own role or the 'all' sentinel.
 *
 * The role list here must stay in sync with the CHECK constraint on
 * user_guide_roles.role (src/db/migrations/userGuides.step1.js).
 */

const express = require("express");
const multer = require("multer");
const path = require("path");
const ftpService = require("../ftp-service");
const {
  pool,
  authenticateToken,
  logUserActivity,
  getIpAddress,
  getUserAgent,
} = require("./utils");

const router = express.Router();

/** Sentinel target meaning "every role sees this guide". */
const ALL_ROLES = "all";

/** Real account roles a guide can be targeted at. */
const TARGETABLE_ROLES = [
  "Admin1",
  "Admin2",
  "Admin3",
  "Admin4",
  "Teacher",
  "Discipline",
  "Psychosocialist",
];

/** Everything accepted in the roles payload. */
const VALID_ROLES = [ALL_ROLES, ...TARGETABLE_ROLES];

/** Only this role may write guides. */
const ADMIN_UPLOAD_ROLE = "Admin3";

const CONTENT_TYPES = ["text", "document", "video", "link"];

const DOC_MIMES = new Set([
  "application/pdf",
  "application/msword",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-powerpoint",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
]);

const VIDEO_MIMES = new Set(["video/mp4", "video/webm", "video/quicktime"]);

/** Extension allow-list, checked alongside the mimetype (step 9.4). */
const DOC_EXTENSIONS = new Set(["pdf", "doc", "docx", "ppt", "pptx"]);
const VIDEO_EXTENSIONS = new Set(["mp4", "webm", "mov"]);

/** Per-type ceilings, enforced in the handler; multer's limit is global. */
const MAX_DOCUMENT_BYTES = 20 * 1024 * 1024;
/** Uploaded / stored videos are capped at 15MB. Larger originals are compressed on the client first. */
const MAX_VIDEO_BYTES = 15 * 1024 * 1024;
const MAX_VIDEO_SOURCE_BYTES = 200 * 1024 * 1024;

/** Remote FTP folder for guide attachments. */
const REMOTE_DIR = "user_guides";

function httpError(statusCode, message) {
  const err = new Error(message);
  err.statusCode = statusCode;
  return err;
}

function badRequest(message) {
  return httpError(400, message);
}

function isGuideAdmin(req) {
  return req.user?.role === ADMIN_UPLOAD_ROLE;
}

/** Hard server-side gate for every write endpoint. */
function requireGuideAdmin(req, res, next) {
  if (!isGuideAdmin(req)) {
    return res.status(403).json({
      error: "Access denied. Only Admin3 can manage user guides.",
    });
  }
  next();
}

/**
 * Accepts a JSON array (["Teacher","Admin4"]), a comma-separated string, or a
 * repeated form field, and returns a clean, de-duplicated role list.
 * Selecting "all" collapses the selection to ['all'] so visibility has exactly
 * one representation in the database.
 */
function normalizeRoles(input) {
  let raw = input;

  if (typeof raw === "string") {
    const trimmed = raw.trim();
    if (trimmed.startsWith("[")) {
      try {
        raw = JSON.parse(trimmed);
      } catch (err) {
        throw badRequest("Target roles must be a valid JSON array");
      }
    } else {
      raw = trimmed.split(",");
    }
  }

  if (!Array.isArray(raw)) {
    raw = raw === undefined || raw === null ? [] : [raw];
  }

  const roles = [...new Set(raw.map((role) => String(role).trim()).filter(Boolean))];

  if (roles.length === 0) {
    throw badRequest("Select at least one role that may view this guide");
  }

  const unknown = roles.filter((role) => !VALID_ROLES.includes(role));
  if (unknown.length) {
    throw badRequest(`Unknown target role: ${unknown.join(", ")}`);
  }

  return roles.includes(ALL_ROLES) ? [ALL_ROLES] : roles;
}

/**
 * Memory storage, because the file goes straight to FTP and is never written
 * to the application server's disk.
 *
 * The limit here is the global ceiling (the largest thing any guide may be);
 * the tighter per-type limits are applied in assertUploadMatchesType once the
 * content type is known. fileFilter cannot do that job: multer streams fields
 * and files in the order the browser sends them, so req.body.content_type is
 * not reliably populated yet. The filter therefore accepts anything in either
 * allow-list, and the handler rejects a mismatch.
 */
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_VIDEO_BYTES, files: 1 },
  fileFilter: (req, file, cb) => {
    if (DOC_MIMES.has(file.mimetype) || VIDEO_MIMES.has(file.mimetype)) {
      return cb(null, true);
    }
    cb(
      new Error(
        "Only PDF, DOC, DOCX, PPT and PPTX documents or MP4, WEBM and MOV videos are allowed"
      )
    );
  },
});

/** Turns multer's own failures into clean JSON instead of a 500. */
function handleGuideUpload(req, res, next) {
  upload.single("file")(req, res, (err) => {
    if (!err) return next();

    if (err.code === "LIMIT_FILE_SIZE") {
      return res.status(413).json({
        error: `File is too large. Videos are stored at ${formatMb(MAX_VIDEO_BYTES)} or less. For long videos, add the guide as a link instead.`,
      });
    }
    if (err.code === "LIMIT_FILE_COUNT" || err.code === "LIMIT_UNEXPECTED_FILE") {
      return res
        .status(400)
        .json({ error: "Send exactly one file, in the 'file' field" });
    }
    return res.status(400).json({ error: err.message || "Invalid upload" });
  });
}

function formatMb(bytes) {
  return `${Math.round(bytes / (1024 * 1024))}MB`;
}

/** Lowercase extension without the dot, or "" when there is none. */
function extensionOf(filename) {
  const ext = path.extname(String(filename || "")).toLowerCase();
  return ext.startsWith(".") ? ext.slice(1) : ext;
}

/**
 * Confirms the uploaded file actually matches the declared content type, on
 * both mimetype and extension, and fits that type's size limit. Checking the
 * extension as well as the mimetype is what stops a "report.pdf.exe" that
 * claims to be a PDF.
 */
function assertUploadMatchesType(file, contentType) {
  if (!file) {
    throw badRequest(`A ${contentType} guide needs a file`);
  }

  const ext = extensionOf(file.originalname);

  if (contentType === "document") {
    if (!DOC_MIMES.has(file.mimetype) || !DOC_EXTENSIONS.has(ext)) {
      throw badRequest(
        `A document guide must be a ${[...DOC_EXTENSIONS].join(", ")} file`
      );
    }
    if (file.size > MAX_DOCUMENT_BYTES) {
      throw httpError(
        413,
        `Documents are limited to ${formatMb(MAX_DOCUMENT_BYTES)}`
      );
    }
    return;
  }

  if (contentType === "video") {
    if (!VIDEO_MIMES.has(file.mimetype) || !VIDEO_EXTENSIONS.has(ext)) {
      throw badRequest(
        `A video guide must be a ${[...VIDEO_EXTENSIONS].join(", ")} file`
      );
    }
    if (file.size > MAX_VIDEO_BYTES) {
      throw httpError(
        413,
        `Videos must be ${formatMb(MAX_VIDEO_BYTES)} or less after compression. Add longer videos as a link instead.`
      );
    }
    return;
  }

  throw badRequest(`A ${contentType} guide does not take a file`);
}

/**
 * Builds a collision-proof remote path. The original name is reduced to safe
 * characters so it cannot escape the folder or break the public URL, while
 * still leaving the file recognisable on the server.
 */
function buildRemotePath(originalname) {
  const ext = extensionOf(originalname);
  const base = path
    .basename(String(originalname || ""), path.extname(String(originalname || "")))
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);

  const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const name = base ? `${stamp}-${base}` : stamp;
  return `${REMOTE_DIR}/${ext ? `${name}.${ext}` : name}`;
}

/**
 * Validates then ships the buffer to FTP, returning the columns the guide row
 * needs. Throws a 502 rather than leaking the FTP error to the client.
 */
async function uploadGuideFile(file, contentType) {
  assertUploadMatchesType(file, contentType);

  const remotePath = buildRemotePath(file.originalname);

  let fileUrl;
  try {
    fileUrl = await ftpService.uploadBuffer(file.buffer, remotePath);
  } catch (err) {
    console.error("User guide upload failed:", err);
    throw httpError(502, "Could not store the file. Please try again.");
  }

  return {
    file_url: fileUrl,
    file_name: file.originalname,
    file_size: file.size,
    mime_type: file.mimetype,
  };
}

/** Columns returned by the list endpoint — body is fetched on open instead. */
const LIST_COLUMNS = `
  g.id, g.title, g.description, g.content_type, g.file_url, g.external_url,
  g.file_name, g.file_size, g.mime_type, g.category, g.sort_order,
  g.is_published, g.view_count, g.created_by, g.created_at, g.updated_at,
  COALESCE(u.name, u.username) AS created_by_name
`;

const ROLES_AGGREGATE = `
  COALESCE(
    json_agg(DISTINCT r.role ORDER BY r.role) FILTER (WHERE r.role IS NOT NULL),
    '[]'::json
  ) AS roles
`;

const GUIDE_JOINS = `
  FROM user_guides g
  LEFT JOIN user_guide_roles r ON r.guide_id = g.id
  LEFT JOIN users u ON u.id = g.created_by
`;

const GROUP_BY = ` GROUP BY g.id, u.name, u.username `;

/**
 * Admin3 sees everything, including drafts. Everyone else sees only published
 * guides whose target roles include their own role or the 'all' sentinel.
 * This filter lives in SQL on purpose: the client is never sent rows it is not
 * allowed to see.
 */
function visibilityClause(req, params) {
  if (isGuideAdmin(req)) return "";

  params.push(req.user.role);
  return `
    AND g.is_published = TRUE
    AND EXISTS (
      SELECT 1 FROM user_guide_roles v
      WHERE v.guide_id = g.id AND v.role IN ('${ALL_ROLES}', $${params.length})
    )`;
}

function parseBoolean(value, fallback = null) {
  if (value === undefined || value === null || value === "") return fallback;
  if (typeof value === "boolean") return value;
  const text = String(value).trim().toLowerCase();
  if (["true", "1", "yes", "on"].includes(text)) return true;
  if (["false", "0", "no", "off"].includes(text)) return false;
  return fallback;
}

function parseSortOrder(value) {
  if (value === undefined || value === null || value === "") return 0;
  const num = Number(value);
  if (!Number.isInteger(num)) {
    throw badRequest("Sort order must be a whole number");
  }
  return num;
}

function parseGuideId(value) {
  const id = Number(value);
  if (!Number.isInteger(id) || id <= 0) {
    throw badRequest("Invalid guide id");
  }
  return id;
}

function cleanText(value, { field, max, required = false }) {
  const text = value === undefined || value === null ? "" : String(value).trim();
  if (!text) {
    if (required) throw badRequest(`${field} is required`);
    return null;
  }
  if (max && text.length > max) {
    throw badRequest(`${field} must be ${max} characters or fewer`);
  }
  return text;
}

/** Only http(s) — blocks javascript: and data: URLs. */
function cleanExternalUrl(value) {
  const text = cleanText(value, { field: "Link", max: 2000, required: true });
  let parsed;
  try {
    parsed = new URL(text);
  } catch (err) {
    throw badRequest("Enter a valid link, including https://");
  }
  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw badRequest("Links must start with http:// or https://");
  }
  return parsed.toString();
}

function parseContentType(value) {
  const type = cleanText(value, { field: "Guide type", required: true });
  if (!CONTENT_TYPES.includes(type)) {
    throw badRequest(`Guide type must be one of: ${CONTENT_TYPES.join(", ")}`);
  }
  return type;
}

/** Escapes LIKE wildcards so a literal % in a search box stays literal. */
function likePattern(value) {
  return `%${String(value).replace(/[\\%_]/g, "\\$&")}%`;
}

function sendError(res, err, fallback) {
  const status = err.statusCode || 500;
  if (status >= 500) console.error(fallback, err);
  res.status(status).json({ error: status >= 500 ? fallback : err.message });
}

async function fetchGuideForViewer(req, id) {
  const params = [id];
  const where = `WHERE g.id = $1 ${visibilityClause(req, params)}`;

  const result = await pool.query(
    `SELECT ${LIST_COLUMNS}, g.body, ${ROLES_AGGREGATE}
     ${GUIDE_JOINS} ${where} ${GROUP_BY}`,
    params
  );
  return result.rows[0] || null;
}

async function fetchGuideById(id) {
  const result = await pool.query(
    `SELECT ${LIST_COLUMNS}, g.body, ${ROLES_AGGREGATE}
     ${GUIDE_JOINS} WHERE g.id = $1 ${GROUP_BY}`,
    [id]
  );
  return result.rows[0] || null;
}

/**
 * Resolves the content columns for a create or update. Exactly one of body,
 * file_url or external_url ends up populated; the others are cleared so a
 * guide that changes type never keeps a stale attachment.
 */
async function resolveContent(contentType, { body, externalUrl, file, existing }) {
  const blank = { body: null, file_url: null, external_url: null, file_name: null, file_size: null, mime_type: null };

  if (contentType === "text") {
    if (file) throw badRequest("A text guide does not take a file");
    return {
      ...blank,
      body: cleanText(body, { field: "Guide text", required: true }),
    };
  }

  if (contentType === "link") {
    if (file) throw badRequest("A link guide does not take a file");
    return { ...blank, external_url: cleanExternalUrl(externalUrl) };
  }

  // document | video
  if (file) {
    return { ...blank, ...(await uploadGuideFile(file, contentType)) };
  }

  // No new file: keep the existing attachment, but only if the type still fits.
  if (existing && existing.content_type === contentType && existing.file_url) {
    return {
      ...blank,
      file_url: existing.file_url,
      file_name: existing.file_name,
      file_size: existing.file_size,
      mime_type: existing.mime_type,
    };
  }

  throw badRequest(`A ${contentType} guide needs a file`);
}

function logGuideActivity(req, action, guide) {
  return logUserActivity(
    req.user.id,
    action,
    `${action} user guide: ${guide.title}`,
    "user_guide",
    guide.id,
    guide.title,
    getIpAddress(req),
    getUserAgent(req)
  ).catch(() => {});
}

/** Every endpoint in this module requires a valid token. */
router.use(authenticateToken);

/**
 * List guides the caller is allowed to see.
 * Filters: ?category= ?type= ?search= (and ?published= for Admin3).
 */
router.get("/", async (req, res) => {
  try {
    const params = [];
    let where = `WHERE 1 = 1 ${visibilityClause(req, params)}`;

    if (req.query.category) {
      params.push(String(req.query.category).trim());
      where += ` AND g.category = $${params.length}`;
    }

    if (req.query.type) {
      const type = parseContentType(req.query.type);
      params.push(type);
      where += ` AND g.content_type = $${params.length}`;
    }

    if (req.query.search) {
      params.push(likePattern(String(req.query.search).trim()));
      where += ` AND (g.title ILIKE $${params.length} OR COALESCE(g.description, '') ILIKE $${params.length})`;
    }

    if (isGuideAdmin(req)) {
      const published = parseBoolean(req.query.published);
      if (published !== null) {
        params.push(published);
        where += ` AND g.is_published = $${params.length}`;
      }
    }

    const result = await pool.query(
      `SELECT ${LIST_COLUMNS}, ${ROLES_AGGREGATE}
       ${GUIDE_JOINS} ${where} ${GROUP_BY}
       ORDER BY g.sort_order ASC, g.created_at DESC`,
      params
    );

    res.json(result.rows);
  } catch (err) {
    sendError(res, err, "Failed to load user guides");
  }
});

/** Distinct categories within what the caller can see, for the filter bar. */
router.get("/meta/categories", async (req, res) => {
  try {
    const params = [];
    const where = `WHERE g.category IS NOT NULL ${visibilityClause(req, params)}`;

    const result = await pool.query(
      `SELECT DISTINCT g.category FROM user_guides g ${where} ORDER BY g.category`,
      params
    );

    res.json(result.rows.map((row) => row.category));
  } catch (err) {
    sendError(res, err, "Failed to load guide categories");
  }
});

/**
 * Role options for the Admin3 upload form, so the frontend never hardcodes
 * the list (step 4.8).
 */
router.get("/meta/roles", requireGuideAdmin, (req, res) => {
  res.json({
    all: ALL_ROLES,
    roles: TARGETABLE_ROLES,
    contentTypes: CONTENT_TYPES,
    limits: {
      documentBytes: MAX_DOCUMENT_BYTES,
      videoBytes: MAX_VIDEO_BYTES,
      videoSourceBytes: MAX_VIDEO_SOURCE_BYTES,
      documentExtensions: [...DOC_EXTENSIONS],
      videoExtensions: [...VIDEO_EXTENSIONS],
    },
  });
});

/** Redirect to the stored file. Visibility is re-checked, not assumed. */
router.get("/:id/download", async (req, res) => {
  try {
    const id = parseGuideId(req.params.id);
    const guide = await fetchGuideForViewer(req, id);

    if (!guide) {
      return res.status(404).json({ error: "Guide not found" });
    }
    if (!["document", "video"].includes(guide.content_type) || !guide.file_url) {
      return res.status(400).json({ error: "This guide has no file to download" });
    }

    res.redirect(guide.file_url);
  } catch (err) {
    sendError(res, err, "Failed to download guide");
  }
});

/** Single guide, including the text body. */
router.get("/:id", async (req, res) => {
  try {
    const id = parseGuideId(req.params.id);
    const guide = await fetchGuideForViewer(req, id);

    if (!guide) {
      return res.status(404).json({ error: "Guide not found" });
    }

    // Admin3 previews its own guides constantly; counting those would make the
    // figure meaningless as a measure of readership.
    if (!isGuideAdmin(req)) {
      pool
        .query(`UPDATE user_guides SET view_count = view_count + 1 WHERE id = $1`, [id])
        .catch((err) => console.error("Failed to count guide view:", err));
    }

    res.json(guide);
  } catch (err) {
    sendError(res, err, "Failed to load guide");
  }
});

/** Create a guide. Admin3 only. */
router.post("/", requireGuideAdmin, handleGuideUpload, async (req, res) => {
  let client;
  try {
    const title = cleanText(req.body.title, { field: "Title", max: 200, required: true });
    const description = cleanText(req.body.description, { field: "Description", max: 2000 });
    const category = cleanText(req.body.category, { field: "Category", max: 100 });
    const contentType = parseContentType(req.body.content_type);
    const sortOrder = parseSortOrder(req.body.sort_order);
    const isPublished = parseBoolean(req.body.is_published, true);
    const roles = normalizeRoles(req.body.roles);

    const content = await resolveContent(contentType, {
      body: req.body.body,
      externalUrl: req.body.external_url,
      file: req.file,
    });

    client = await pool.connect();
    await client.query("BEGIN");

    const inserted = await client.query(
      `INSERT INTO user_guides
         (title, description, content_type, body, file_url, external_url,
          file_name, file_size, mime_type, category, sort_order, is_published, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
       RETURNING id, title`,
      [
        title,
        description,
        contentType,
        content.body,
        content.file_url,
        content.external_url,
        content.file_name,
        content.file_size,
        content.mime_type,
        category,
        sortOrder,
        isPublished,
        req.user.id,
      ]
    );

    const guideId = inserted.rows[0].id;
    await client.query(
      `INSERT INTO user_guide_roles (guide_id, role)
       SELECT $1, UNNEST($2::text[])`,
      [guideId, roles]
    );

    await client.query("COMMIT");

    const guide = await fetchGuideById(guideId);
    logGuideActivity(req, "create", guide);
    res.status(201).json(guide);
  } catch (err) {
    if (client) await client.query("ROLLBACK").catch(() => {});
    sendError(res, err, "Failed to create user guide");
  } finally {
    if (client) client.release();
  }
});

/** Update a guide. Admin3 only. Omitted fields keep their current value. */
router.put("/:id", requireGuideAdmin, handleGuideUpload, async (req, res) => {
  let client;
  try {
    const id = parseGuideId(req.params.id);
    const existing = await fetchGuideById(id);
    if (!existing) {
      return res.status(404).json({ error: "Guide not found" });
    }

    const title =
      req.body.title === undefined
        ? existing.title
        : cleanText(req.body.title, { field: "Title", max: 200, required: true });
    const description =
      req.body.description === undefined
        ? existing.description
        : cleanText(req.body.description, { field: "Description", max: 2000 });
    const category =
      req.body.category === undefined
        ? existing.category
        : cleanText(req.body.category, { field: "Category", max: 100 });
    const contentType =
      req.body.content_type === undefined
        ? existing.content_type
        : parseContentType(req.body.content_type);
    const sortOrder =
      req.body.sort_order === undefined
        ? existing.sort_order
        : parseSortOrder(req.body.sort_order);
    const isPublished = parseBoolean(req.body.is_published, existing.is_published);
    const roles =
      req.body.roles === undefined ? null : normalizeRoles(req.body.roles);

    const content = await resolveContent(contentType, {
      body: req.body.body === undefined ? existing.body : req.body.body,
      externalUrl:
        req.body.external_url === undefined
          ? existing.external_url
          : req.body.external_url,
      file: req.file,
      existing,
    });

    client = await pool.connect();
    await client.query("BEGIN");

    await client.query(
      `UPDATE user_guides SET
         title = $1, description = $2, content_type = $3, body = $4,
         file_url = $5, external_url = $6, file_name = $7, file_size = $8,
         mime_type = $9, category = $10, sort_order = $11, is_published = $12,
         updated_at = NOW()
       WHERE id = $13`,
      [
        title,
        description,
        contentType,
        content.body,
        content.file_url,
        content.external_url,
        content.file_name,
        content.file_size,
        content.mime_type,
        category,
        sortOrder,
        isPublished,
        id,
      ]
    );

    if (roles) {
      await client.query(`DELETE FROM user_guide_roles WHERE guide_id = $1`, [id]);
      await client.query(
        `INSERT INTO user_guide_roles (guide_id, role)
         SELECT $1, UNNEST($2::text[])`,
        [id, roles]
      );
    }

    await client.query("COMMIT");

    const guide = await fetchGuideById(id);
    logGuideActivity(req, "update", guide);
    res.json(guide);
  } catch (err) {
    if (client) await client.query("ROLLBACK").catch(() => {});
    sendError(res, err, "Failed to update user guide");
  } finally {
    if (client) client.release();
  }
});

/** Publish or unpublish. Admin3 only. Toggles when no value is sent. */
router.patch("/:id/publish", requireGuideAdmin, async (req, res) => {
  try {
    const id = parseGuideId(req.params.id);
    const requested = parseBoolean(req.body?.is_published);

    const result = await pool.query(
      `UPDATE user_guides
         SET is_published = COALESCE($2, NOT is_published), updated_at = NOW()
       WHERE id = $1
       RETURNING id, title, is_published`,
      [id, requested]
    );

    if (!result.rows.length) {
      return res.status(404).json({ error: "Guide not found" });
    }

    const guide = result.rows[0];
    logGuideActivity(req, guide.is_published ? "publish" : "unpublish", guide);
    res.json(guide);
  } catch (err) {
    sendError(res, err, "Failed to update guide visibility");
  }
});

/** Delete a guide. Admin3 only. Role rows cascade. */
router.delete("/:id", requireGuideAdmin, async (req, res) => {
  try {
    const id = parseGuideId(req.params.id);

    const result = await pool.query(
      `DELETE FROM user_guides WHERE id = $1 RETURNING id, title`,
      [id]
    );

    if (!result.rows.length) {
      return res.status(404).json({ error: "Guide not found" });
    }

    logGuideActivity(req, "delete", result.rows[0]);
    res.json({ success: true, id: result.rows[0].id });
  } catch (err) {
    sendError(res, err, "Failed to delete user guide");
  }
});

module.exports = router;
module.exports.ALL_ROLES = ALL_ROLES;
module.exports.VALID_ROLES = VALID_ROLES;
module.exports.TARGETABLE_ROLES = TARGETABLE_ROLES;
module.exports.CONTENT_TYPES = CONTENT_TYPES;
module.exports.DOC_MIMES = DOC_MIMES;
module.exports.VIDEO_MIMES = VIDEO_MIMES;
module.exports.DOC_EXTENSIONS = DOC_EXTENSIONS;
module.exports.VIDEO_EXTENSIONS = VIDEO_EXTENSIONS;
module.exports.MAX_DOCUMENT_BYTES = MAX_DOCUMENT_BYTES;
module.exports.MAX_VIDEO_BYTES = MAX_VIDEO_BYTES;
module.exports.REMOTE_DIR = REMOTE_DIR;
module.exports.isGuideAdmin = isGuideAdmin;
module.exports.requireGuideAdmin = requireGuideAdmin;
module.exports.normalizeRoles = normalizeRoles;
module.exports.badRequest = badRequest;
module.exports.httpError = httpError;
module.exports.handleGuideUpload = handleGuideUpload;
module.exports.extensionOf = extensionOf;
module.exports.assertUploadMatchesType = assertUploadMatchesType;
module.exports.buildRemotePath = buildRemotePath;
module.exports.uploadGuideFile = uploadGuideFile;
module.exports.formatMb = formatMb;
