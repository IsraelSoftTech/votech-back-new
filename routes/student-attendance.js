const express = require("express");

const { authenticateToken } = require("./utils");
const { getActiveYear } = require("../src/services/activeAcademicYear.service");
const {
  processAttendanceScan,
  getAttendanceReport,
  listReportClasses,
} = require("../src/services/studentAttendance.service");
const {
  getSchoolHours,
  getSchoolHoursWithScannerStatus,
  updateSchoolHours,
} = require("../src/services/schoolHours.service");

const router = express.Router();

router.use(authenticateToken);

/** Simple in-memory rate limit for scan endpoint */
const scanHits = new Map();
const SCAN_WINDOW_MS = 60_000;
const SCAN_MAX_PER_WINDOW = 120;

function scanRateLimit(req, res, next) {
  const key = req.ip || req.headers["x-forwarded-for"] || "unknown";
  const now = Date.now();
  let bucket = scanHits.get(key);
  if (!bucket || now - bucket.start > SCAN_WINDOW_MS) {
    bucket = { start: now, count: 0 };
    scanHits.set(key, bucket);
  }
  bucket.count += 1;
  if (bucket.count > SCAN_MAX_PER_WINDOW) {
    return res.status(429).json({ error: "Too many scan requests. Please wait." });
  }
  return next();
}

function canManageSchoolHours(role) {
  return ["Admin1", "Admin3"].includes(role);
}

router.post("/scan", scanRateLimit, async (req, res) => {
  try {
    const qrToken =
      req.body?.qr_token || req.body?.token || req.query?.token || "";
    const action = req.body?.action === "check_out" ? "check_out" : "check_in";
    const result = await processAttendanceScan(qrToken, action);
    res.json(result);
  } catch (e) {
    const status = e.statusCode || 500;
    if (status >= 500) console.error("Attendance scan error:", e);
    res.status(status).json({
      error: e.message || "Scan failed",
      ...(e.details ? { details: e.details } : {}),
    });
  }
});

router.get("/school-hours", async (req, res) => {
  try {
    const settings = await getSchoolHoursWithScannerStatus();
    res.json(settings);
  } catch (e) {
    console.error("Get school hours error:", e);
    res.status(500).json({ error: "Failed to fetch school hours" });
  }
});

router.put("/school-hours", async (req, res) => {
  try {
    const role = req.user?.role || "";
    if (!canManageSchoolHours(role)) {
      return res.status(403).json({ error: "Not authorized" });
    }
    const settings = await updateSchoolHours(req.body, req.user?.id ?? null);
    res.json({ message: "School hours saved", settings });
  } catch (e) {
    const status = e.statusCode || 500;
    console.error("Update school hours error:", e);
    res.status(status).json({ error: e.message || "Failed to save school hours" });
  }
});

router.get("/report/classes", async (req, res) => {
  try {
    let yearId = req.query.academic_year_id
      ? Number(req.query.academic_year_id)
      : null;
    if (!yearId) {
      const active = await getActiveYear();
      yearId = active?.id ?? null;
    }
    const classes = await listReportClasses(yearId);
    res.json(classes);
  } catch (e) {
    console.error("List attendance classes error:", e);
    res.status(500).json({ error: "Failed to fetch classes" });
  }
});

router.get("/report", async (req, res) => {
  try {
    let yearId = req.query.academic_year_id
      ? Number(req.query.academic_year_id)
      : null;
    if (!yearId) {
      const active = await getActiveYear();
      yearId = active?.id ?? null;
    }

    const fromDate = req.query.from || req.query.from_date || null;
    const toDate = req.query.to || req.query.to_date || null;
    const classId = req.query.class_id || req.query.classId || null;

    const report = await getAttendanceReport({
      fromDate,
      toDate,
      classId: classId && classId !== "all" ? classId : null,
      academicYearId: yearId,
    });

    res.json(report);
  } catch (e) {
    console.error("Attendance report error:", e);
    res.status(500).json({ error: "Failed to generate attendance report" });
  }
});

/** Print-friendly payload (same data, flagged for client PDF/print) */
router.get("/report/print", async (req, res) => {
  try {
    let yearId = req.query.academic_year_id
      ? Number(req.query.academic_year_id)
      : null;
    if (!yearId) {
      const active = await getActiveYear();
      yearId = active?.id ?? null;
    }

    const fromDate = req.query.from || req.query.from_date || null;
    const toDate = req.query.to || req.query.to_date || null;
    const classId = req.query.class_id || req.query.classId || null;

    const report = await getAttendanceReport({
      fromDate,
      toDate,
      classId: classId && classId !== "all" ? classId : null,
      academicYearId: yearId,
    });

    res.json({
      ...report,
      print: true,
      generated_at: new Date().toISOString(),
    });
  } catch (e) {
    console.error("Attendance print report error:", e);
    res.status(500).json({ error: "Failed to generate print report" });
  }
});

module.exports = router;
