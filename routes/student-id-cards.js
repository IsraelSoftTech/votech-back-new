const express = require("express");

const { authenticateToken } = require("./utils");

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

router.get("/settings", async (req, res) => {
  try {
    const settings = await getIdCardSettings();
    res.json(settings);
  } catch (e) {
    console.error("Get ID card settings error:", e);
    res.status(500).json({ error: "Failed to fetch ID card settings" });
  }
});

router.put("/settings", async (req, res) => {
  try {
    const role = req.user?.role || "";
    if (!["Admin1", "Admin3"].includes(role)) {
      return res.status(403).json({ error: "Not authorized" });
    }

    const settings = await updateIdCardSettings(req.body, req.user?.id ?? null);
    res.json({
      message: "ID card settings saved",
      settings,
    });
  } catch (e) {
    console.error("Update ID card settings error:", e);
    res.status(500).json({ error: "Failed to save ID card settings" });
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
