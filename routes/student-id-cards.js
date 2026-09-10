const express = require("express");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const https = require("https");
const http = require("http");

const { authenticateToken } = require("./utils");
const ftpService = require("../ftp-service");

const { getActiveYear } = require("../src/services/activeAcademicYear.service");

const {
  listStudentIdCards,
  listStudentIdCardsPaginated,
  getStudentIdCardByStudentDbId,
  getStudentIdCardsByIds,
  backfillMissingCards,
} = require("../src/services/studentIdCard.service");

const {
  getIdCardSettings,
  updateIdCardSettings,
} = require("../src/services/idCardSettings.service");

const router = express.Router();

router.use(authenticateToken);

const STAMP_MIME = new Set([
  "image/png",
  "image/jpeg",
  "image/jpg",
  "image/webp",
  "image/gif",
]);

const stampUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (!STAMP_MIME.has(file.mimetype)) {
      return cb(new Error("Stamp must be a PNG, JPG, WEBP, or GIF image"));
    }
    cb(null, true);
  },
});

function handleStampUpload(req, res, next) {
  stampUpload.single("stamp")(req, res, (err) => {
    if (err) {
      return res.status(400).json({ error: err.message || "Invalid stamp upload" });
    }
    next();
  });
}

function fetchRemoteBuffer(url) {
  return new Promise((resolve, reject) => {
    const client = url.startsWith("https:") ? https : http;
    const request = client.get(url, { timeout: 15000 }, (response) => {
      if (
        response.statusCode >= 300 &&
        response.statusCode < 400 &&
        response.headers.location
      ) {
        response.resume();
        fetchRemoteBuffer(response.headers.location).then(resolve).catch(reject);
        return;
      }
      if (response.statusCode !== 200) {
        response.resume();
        reject(new Error(`Stamp fetch failed (${response.statusCode})`));
        return;
      }
      const chunks = [];
      response.on("data", (chunk) => chunks.push(chunk));
      response.on("end", () =>
        resolve({
          buffer: Buffer.concat(chunks),
          contentType: response.headers["content-type"] || "image/png",
        })
      );
    });
    request.on("error", reject);
    request.on("timeout", () => {
      request.destroy();
      reject(new Error("Stamp fetch timed out"));
    });
  });
}

router.get("/settings", async (req, res) => {
  try {
    const settings = await getIdCardSettings();
    res.json(settings);
  } catch (e) {
    console.error("Get ID card settings error:", e);
    res.status(500).json({ error: "Failed to fetch ID card settings" });
  }
});

router.get("/settings/stamp", async (req, res) => {
  try {
    const settings = await getIdCardSettings();
    if (!settings.stamp_url) {
      return res.status(404).json({ error: "No stamp uploaded" });
    }

    const url = String(settings.stamp_url);
    if (url.startsWith("http://") || url.startsWith("https://")) {
      const { buffer, contentType } = await fetchRemoteBuffer(url);
      res.setHeader("Content-Type", contentType);
      res.setHeader("Cache-Control", "public, max-age=86400");
      return res.send(buffer);
    }

    const localPath = path.isAbsolute(url)
      ? url
      : path.join(__dirname, "../local_uploads", url.replace(/^\/+/, ""));
    if (!fs.existsSync(localPath)) {
      return res.status(404).json({ error: "Stamp file not found" });
    }
    const ext = path.extname(localPath).toLowerCase();
    const type =
      ext === ".jpg" || ext === ".jpeg"
        ? "image/jpeg"
        : ext === ".webp"
        ? "image/webp"
        : ext === ".gif"
        ? "image/gif"
        : "image/png";
    res.setHeader("Content-Type", type);
    res.setHeader("Cache-Control", "public, max-age=86400");
    return res.send(fs.readFileSync(localPath));
  } catch (e) {
    console.error("Get ID card stamp error:", e);
    res.status(500).json({ error: "Failed to load stamp image" });
  }
});

router.put("/settings", handleStampUpload, async (req, res) => {
  try {
    const role = req.user?.role || "";
    if (!["Admin1", "Admin3"].includes(role)) {
      return res.status(403).json({ error: "Not authorized" });
    }

    const payload = { ...req.body };
    const removeStamp =
      payload.remove_stamp === "true" || payload.remove_stamp === true;

    if (req.file) {
      const ext = path.extname(req.file.originalname || ".png") || ".png";
      const safeExt = [".png", ".jpg", ".jpeg", ".webp", ".gif"].includes(
        ext.toLowerCase()
      )
        ? ext.toLowerCase()
        : ".png";
      const remotePath = `id-cards/stamp/${Date.now()}-${Math.random()
        .toString(36)
        .slice(2)}${safeExt}`;
      payload.stamp_url = await ftpService.uploadBuffer(
        req.file.buffer,
        remotePath
      );
    } else if (removeStamp) {
      payload.stamp_url = null;
    }

    delete payload.remove_stamp;
    delete payload.stamp_src;
    delete payload.stampFile;

    const settings = await updateIdCardSettings(payload, req.user?.id ?? null);
    res.json({
      message: "ID card settings saved",
      settings,
    });
  } catch (e) {
    console.error("Update ID card settings error:", e);
    res.status(500).json({ error: e.message || "Failed to save ID card settings" });
  }
});

router.post("/backfill", async (req, res) => {
  try {
    const role = req.user?.role || "";
    if (!["Admin1", "Admin3"].includes(role)) {
      return res.status(403).json({ error: "Not authorized" });
    }

    const result = await backfillMissingCards();
    res.json({
      message: `Backfill complete: ${result.created} card(s) created`,
      ...result,
    });
  } catch (e) {
    console.error("Backfill student ID cards error:", e);
    res.status(500).json({ error: "Failed to backfill ID cards" });
  }
});

router.post("/batch", async (req, res) => {
  try {
    const ids = Array.isArray(req.body?.ids) ? req.body.ids : [];
    const rows = await getStudentIdCardsByIds(ids);
    res.json(rows);
  } catch (e) {
    console.error("Batch student ID cards error:", e);
    res.status(500).json({ error: "Failed to fetch student ID cards" });
  }
});

async function resolveYearFilter(req) {
  let yearFilter = req.query.academic_year_id
    ? Number(req.query.academic_year_id)
    : null;

  if (!yearFilter && req.query.all_years !== "true") {
    const active = await getActiveYear();
    yearFilter = active?.id ?? null;
  }

  return yearFilter;
}

router.get("/", async (req, res) => {
  try {
    const yearFilter = await resolveYearFilter(req);

    if (req.query.paginated === "true" || req.query.page != null) {
      const result = await listStudentIdCardsPaginated({
        yearFilter,
        page: req.query.page,
        limit: req.query.limit,
        search: req.query.search || "",
        className: req.query.class_name || req.query.class || "",
        cardStatus: req.query.card_status || req.query.status || "",
      });
      return res.json(result);
    }

    const rows = await listStudentIdCards({ yearFilter });
    res.json(rows);
  } catch (e) {
    console.error("List student ID cards error:", e);
    res.status(500).json({ error: "Failed to fetch student ID cards" });
  }
});

router.get("/:studentDbId", async (req, res) => {
  try {
    if (req.params.studentDbId === "settings") {
      return res.status(404).json({ error: "Not found" });
    }

    const row = await getStudentIdCardByStudentDbId(req.params.studentDbId);
    if (!row) {
      return res.status(404).json({ error: "Student not found" });
    }

    res.json(row);
  } catch (e) {
    console.error("Get student ID card error:", e);
    res.status(500).json({ error: "Failed to fetch student ID card" });
  }
});

module.exports = router;
