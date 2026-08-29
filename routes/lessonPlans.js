const express = require("express");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const { Pool } = require("pg");
const ftpService = require("../ftp-service");
require("dotenv").config();

const { ChangeTypes, logChanges } = require("../src/utils/logChanges.util");

const isDesktop = process.env.NODE_ENV === "desktop";
const db = isDesktop
  ? process.env.DATABASE_URL_LOCAL
  : process.env.DATABASE_URL;

const router = express.Router();
const pool = new Pool({
  connectionString: db,
});

// Activity logging function
const logUserActivity = async (
  userId,
  activityType,
  activityDescription,
  entityType = null,
  entityId = null,
  entityName = null,
  ipAddress = null,
  userAgent = null
) => {
  try {
    await pool.query(
      `
      INSERT INTO user_activities (user_id, activity_type, activity_description, entity_type, entity_id, entity_name, ip_address, user_agent)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
    `,
      [
        userId,
        activityType,
        activityDescription,
        entityType,
        entityId,
        entityName,
        ipAddress,
        userAgent,
      ]
    );
  } catch (error) {
    console.error("Error logging user activity:", error);
  }
};

// Authentication middleware
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers["authorization"];
  if (!authHeader) {
    return res.status(401).json({ error: "No authorization header" });
  }

  const token = authHeader.split(" ")[1];
  if (!token) {
    return res.status(401).json({ error: "No token provided" });
  }

  // Special handling for Admin3 hardcoded token
  if (token === "admin3-special-token-2024") {
    // Create a mock user object for Admin3
    req.user = {
      id: 999,
      username: "Admin3",
      role: "Admin3",
      name: "System Administrator",
    };
    return next();
  }

  try {
    const jwt = require("jsonwebtoken");
    const JWT_SECRET = process.env.JWT_SECRET || "your-secret-key";
    const user = jwt.verify(token, JWT_SECRET);
    req.user = user;
    next();
  } catch (err) {
    if (err.name === "TokenExpiredError") {
      return res.status(401).json({ error: "Token expired" });
    }
    return res.status(403).json({ error: "Invalid token" });
  }
};

const ADMIN_LIST_ROLES = [
  "Admin1",
  "Admin2",
  "Admin3",
  "Admin4",
  "admin",
  "Dean",
];
const REVIEW_ROLES = ["Admin1", "Admin2", "Admin4", "admin", "Dean"];
const ADMIN_DELETE_ROLES = ["Admin1", "Admin2", "Admin4", "admin", "Dean"];

const isAdmin3 = (user) => user?.role === "Admin3";

const denyAdmin3Write = (req, res, next) => {
  if (isAdmin3(req.user)) {
    return res.status(403).json({
      error:
        "Admin3 has download-only access to approved lesson plans. Upload, edit, review, and delete are not permitted.",
    });
  }
  next();
};

const buildLessonPlanListQuery = (req) => {
  const {
    class: classFilter,
    department,
    specialty,
    status,
    search,
    page = "1",
    limit = "100",
  } = req.query;

  const departmentId = department || specialty;
  const isAdmin3User = isAdmin3(req.user);
  const params = [];
  const conditions = [];

  if (isAdmin3User) {
    conditions.push(`lp.status = 'approved'`);
  } else if (status && status !== "all") {
    params.push(status);
    conditions.push(`lp.status = $${params.length}`);
  }

  if (classFilter) {
    const classId = parseInt(classFilter, 10);
    if (!Number.isNaN(classId)) {
      params.push(classId);
      const idx = params.length;
      conditions.push(`(
        lp.class_id = $${idx}
        OR EXISTS (
          SELECT 1 FROM class_subjects cs
          WHERE cs.teacher_id = lp.user_id AND cs.class_id = $${idx}
        )
      )`);
    }
  }

  if (departmentId) {
    const deptId = parseInt(departmentId, 10);
    if (!Number.isNaN(deptId)) {
      params.push(deptId);
      const idx = params.length;
      conditions.push(`(
        lp.department_id = $${idx}
        OR c.department_id = $${idx}
        OR EXISTS (
          SELECT 1 FROM class_subjects cs
          WHERE cs.teacher_id = lp.user_id AND cs.department_id = $${idx}
        )
      )`);
    }
  }

  if (search && String(search).trim()) {
    params.push(`%${String(search).trim().toLowerCase()}%`);
    const idx = params.length;
    conditions.push(`(
      LOWER(lp.title) LIKE $${idx}
      OR LOWER(COALESCE(lp.file_name, '')) LIKE $${idx}
      OR LOWER(COALESCE(lp.subject, '')) LIKE $${idx}
      OR LOWER(COALESCE(u.name, '')) LIKE $${idx}
      OR LOWER(COALESCE(u.username, '')) LIKE $${idx}
    )`);
  }

  const whereClause =
    conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

  const pageNum = Math.max(1, parseInt(page, 10) || 1);
  const limitNum = Math.min(500, Math.max(1, parseInt(limit, 10) || 100));
  const offset = (pageNum - 1) * limitNum;

  params.push(limitNum);
  const limitIdx = params.length;
  params.push(offset);
  const offsetIdx = params.length;

  const sql = `
    SELECT
      lp.*,
      u.name AS teacher_name,
      u.username AS teacher_username,
      u.role AS teacher_role,
      c.name AS class_label,
      COALESCE(sp.name, sp2.name) AS department_name
    FROM lesson_plans lp
    LEFT JOIN users u ON lp.user_id = u.id
    LEFT JOIN classes c ON lp.class_id = c.id
    LEFT JOIN specialties sp ON lp.department_id = sp.id
    LEFT JOIN specialties sp2 ON c.department_id = sp2.id
    ${whereClause}
    ORDER BY lp.submitted_at DESC NULLS LAST, lp.id DESC
    LIMIT $${limitIdx} OFFSET $${offsetIdx}
  `;

  const countSql = `
    SELECT COUNT(*)::int AS total
    FROM lesson_plans lp
    LEFT JOIN users u ON lp.user_id = u.id
    LEFT JOIN classes c ON lp.class_id = c.id
    ${whereClause}
  `;

  return { sql, countSql, params, pageNum, limitNum };
};

// Configure multer for file uploads - using memory storage for FTP upload
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB limit
  },
  fileFilter: function (req, file, cb) {
    // Accept PDF, DOC, DOCX files
    const allowedTypes = [
      "application/pdf",
      "application/msword",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ];
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new Error("Only PDF, DOC, and DOCX files are allowed!"), false);
    }
  },
});

// Create lesson plans table if it doesn't exist
const initializeLessonPlansTable = async () => {
  try {
    // First create the table with basic schema if it doesn't exist
    await pool.query(`
      CREATE TABLE IF NOT EXISTS lesson_plans (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        title VARCHAR(255) NOT NULL,
        period_type VARCHAR(20) NOT NULL CHECK (period_type IN ('weekly', 'monthly', 'yearly')),
        file_url VARCHAR(500) NOT NULL,
        status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
        admin_comment TEXT,
        submitted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        reviewed_at TIMESTAMP,
        reviewed_by INTEGER REFERENCES users(id) ON DELETE SET NULL
      )
    `);

    // Check if submitted_at column exists, if not add it
    const hasSubmittedAt = await pool.query(`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name = 'lesson_plans' AND column_name = 'submitted_at'
    `);

    if (hasSubmittedAt.rows.length === 0) {
      await pool.query(`
        ALTER TABLE lesson_plans 
        ADD COLUMN submitted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      `);
      console.log("Added submitted_at column to lesson_plans table");
    }

    await pool.query(`
      ALTER TABLE lesson_plans
        ADD COLUMN IF NOT EXISTS class_id INTEGER REFERENCES classes(id) ON DELETE SET NULL,
        ADD COLUMN IF NOT EXISTS department_id INTEGER REFERENCES specialties(id) ON DELETE SET NULL
    `);

    // Lesson plans table initialized with correct schema
  } catch (error) {
    console.error("Error initializing lesson plans table:", error);
  }
};

// Initialize table on module load
initializeLessonPlansTable();

// Upload a new lesson plan
router.post("/", authenticateToken, denyAdmin3Write, upload.single("file"), async (req, res) => {
  try {
    const { title, period_type, class_id, department_id } = req.body;
    const ipAddress = req.ip || req.connection.remoteAddress;
    const userAgent = req.get("User-Agent");

    if (!title) {
      return res.status(400).json({ error: "Title is required" });
    }

    if (!req.file) {
      return res.status(400).json({ error: "File is required" });
    }

    let fileUrl = null;
    try {
      const filename = `lesson_plan_${Date.now()}_${req.file.originalname}`;
      fileUrl = await ftpService.uploadBuffer(req.file.buffer, filename);
      console.log("Lesson plan uploaded to FTP:", fileUrl);
    } catch (error) {
      console.error("Failed to upload lesson plan to FTP:", error);
      return res.status(500).json({ error: "Failed to upload lesson plan" });
    }

    const result = await pool.query(
      `INSERT INTO lesson_plans (user_id, title, period_type, file_url, class_id, department_id) 
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [
        req.user.id,
        title,
        period_type || "weekly",
        fileUrl,
        class_id ? parseInt(class_id, 10) || null : null,
        department_id ? parseInt(department_id, 10) || null : null,
      ]
    );

    // Log the activity
    await logUserActivity(
      req.user.id,
      "create",
      `Uploaded lesson plan: ${title}`,
      "lesson_plan",
      result.rows[0].id,
      title,
      ipAddress,
      userAgent
    );

    await logChanges(
      "lesson_plans",
      result.rows[0].id,
      ChangeTypes.create,
      req.user
    );
    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error("Error uploading lesson plan:", error);
    res.status(500).json({ error: "Failed to upload lesson plan" });
  }
});

// Get my lesson plans (for teachers)
router.get("/my", authenticateToken, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT * FROM lesson_plans WHERE user_id = $1 ORDER BY submitted_at DESC`,
      [req.user.id]
    );
    res.json(result.rows);
  } catch (error) {
    console.error("Error fetching my lesson plans:", error);
    res.status(500).json({ error: "Failed to fetch lesson plans" });
  }
});

// Get all lesson plans (for admins)
router.get("/all", authenticateToken, async (req, res) => {
  try {
    console.log(
      "Get all lesson plans request from user:",
      req.user.id,
      "Role:",
      req.user.role
    );

    if (!ADMIN_LIST_ROLES.includes(req.user.role)) {
      return res.status(403).json({ error: "Access denied" });
    }

    const { sql, countSql, params, pageNum, limitNum } =
      buildLessonPlanListQuery(req);
    const countParams = params.slice(0, params.length - 2);

    const [result, countResult] = await Promise.all([
      pool.query(sql, params),
      pool.query(countSql, countParams),
    ]);

    const total = countResult.rows[0]?.total ?? result.rows.length;
    console.log("Found", result.rows.length, "lesson plans (total:", total, ")");

    res.json({
      items: result.rows,
      total,
      page: pageNum,
      limit: limitNum,
    });
  } catch (error) {
    console.error("Error fetching all lesson plans:", error);
    res.status(500).json({ error: "Failed to fetch all lesson plans" });
  }
});

// Download an approved lesson plan (Admin3 download-only access)
router.get("/:id/download", authenticateToken, async (req, res) => {
  try {
    const lessonPlanId = parseInt(req.params.id, 10);
    if (Number.isNaN(lessonPlanId)) {
      return res.status(400).json({ error: "Invalid lesson plan id" });
    }

    if (!ADMIN_LIST_ROLES.includes(req.user.role)) {
      return res.status(403).json({ error: "Access denied" });
    }

    const result = await pool.query(
      `SELECT lp.*, u.name AS teacher_name
       FROM lesson_plans lp
       LEFT JOIN users u ON lp.user_id = u.id
       WHERE lp.id = $1`,
      [lessonPlanId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Lesson plan not found" });
    }

    const plan = result.rows[0];

    if (isAdmin3(req.user) && plan.status !== "approved") {
      return res.status(403).json({
        error: "Admin3 can only download approved lesson plans.",
      });
    }

    if (!plan.file_url) {
      return res.status(404).json({ error: "No file available for download" });
    }

    res.json({
      id: plan.id,
      title: plan.title,
      file_url: plan.file_url,
      file_name: plan.file_name || `${plan.title || "lesson_plan"}.pdf`,
      status: plan.status,
      teacher_name: plan.teacher_name,
    });
  } catch (error) {
    console.error("Error downloading lesson plan:", error);
    res.status(500).json({ error: "Failed to download lesson plan" });
  }
});

// Update a lesson plan
router.put(
  "/:id",
  authenticateToken,
  denyAdmin3Write,
  upload.single("file"),
  async (req, res) => {
    try {
      const lessonPlanId = parseInt(req.params.id);
      const ipAddress = req.ip || req.connection.remoteAddress;
      const userAgent = req.get("User-Agent");

      const {
        title,
        subject,
        class_name,
        week,
        objectives,
        content,
        activities,
        assessment,
        resources,
        period_type,
      } = req.body;

      // Check if lesson plan belongs to user
      const existingPlan = await pool.query(
        "SELECT * FROM lesson_plans WHERE id = $1 AND user_id = $2",
        [lessonPlanId, req.user.id]
      );

      if (existingPlan.rows.length === 0) {
        return res.status(404).json({ error: "Lesson plan not found" });
      }

      let fileUrl = existingPlan.rows[0].file_url;
      let fileName = existingPlan.rows[0].file_name;

      if (req.file) {
        try {
          const filename = `lesson_plan_${Date.now()}_${req.file.originalname}`;
          fileUrl = await ftpService.uploadBuffer(req.file.buffer, filename);
          fileName = req.file.originalname;
          console.log("Updated lesson plan uploaded to FTP:", fileUrl);
        } catch (error) {
          console.error("Failed to upload updated lesson plan to FTP:", error);
          return res
            .status(500)
            .json({ error: "Failed to upload updated lesson plan" });
        }
      }

      const result = await pool.query(
        `UPDATE lesson_plans SET 
        title = $1, subject = $2, class_name = $3, week = $4, 
        objectives = $5, content = $6, activities = $7, 
        assessment = $8, resources = $9, file_url = $10, 
        file_name = $11, period_type = $12, updated_at = CURRENT_TIMESTAMP
       WHERE id = $13 AND user_id = $14 RETURNING *`,
        [
          title,
          subject,
          class_name,
          week,
          objectives,
          content,
          activities,
          assessment,
          resources,
          fileUrl,
          fileName,
          period_type || "weekly",
          lessonPlanId,
          req.user.id,
        ]
      );

      // Log the activity
      await logUserActivity(
        req.user.id,
        "update",
        `Updated lesson plan: ${title}`,
        "lesson_plan",
        lessonPlanId,
        title,
        ipAddress,
        userAgent
      );

      const fieldsChanged = {};
      const old = existingPlan.rows[0];
      const updated = result.rows[0];
      if (old.title !== updated.title)
        fieldsChanged.title = { before: old.title, after: updated.title };
      if (old.subject !== updated.subject)
        fieldsChanged.subject = { before: old.subject, after: updated.subject };
      if (old.class_name !== updated.class_name)
        fieldsChanged.class_name = {
          before: old.class_name,
          after: updated.class_name,
        };
      if (old.week !== updated.week)
        fieldsChanged.week = { before: old.week, after: updated.week };
      if (old.objectives !== updated.objectives)
        fieldsChanged.objectives = {
          before: old.objectives,
          after: updated.objectives,
        };
      if (old.content !== updated.content)
        fieldsChanged.content = { before: old.content, after: updated.content };
      if (old.activities !== updated.activities)
        fieldsChanged.activities = {
          before: old.activities,
          after: updated.activities,
        };
      if (old.assessment !== updated.assessment)
        fieldsChanged.assessment = {
          before: old.assessment,
          after: updated.assessment,
        };
      if (old.resources !== updated.resources)
        fieldsChanged.resources = {
          before: old.resources,
          after: updated.resources,
        };
      if (old.file_url !== updated.file_url)
        fieldsChanged.file_url = {
          before: old.file_url,
          after: updated.file_url,
        };
      if (old.file_name !== updated.file_name)
        fieldsChanged.file_name = {
          before: old.file_name,
          after: updated.file_name,
        };
      if (old.period_type !== updated.period_type)
        fieldsChanged.period_type = {
          before: old.period_type,
          after: updated.period_type,
        };
      await logChanges(
        "lesson_plans",
        lessonPlanId,
        ChangeTypes.update,
        req.user,
        fieldsChanged
      );
      res.json(result.rows[0]);
    } catch (error) {
      console.error("Error updating lesson plan:", error);
      res.status(500).json({ error: "Failed to update lesson plan" });
    }
  }
);

// Delete a lesson plan (teacher can delete their own)
router.delete("/:id", authenticateToken, denyAdmin3Write, async (req, res) => {
  try {
    const lessonPlanId = parseInt(req.params.id);
    const ipAddress = req.ip || req.connection.remoteAddress;
    const userAgent = req.get("User-Agent");

    // Check if lesson plan belongs to user
    const existingPlan = await pool.query(
      "SELECT * FROM lesson_plans WHERE id = $1 AND user_id = $2",
      [lessonPlanId, req.user.id]
    );

    if (existingPlan.rows.length === 0) {
      return res.status(404).json({ error: "Lesson plan not found" });
    }

    // Log the activity before deletion
    await logUserActivity(
      req.user.id,
      "delete",
      `Deleted lesson plan: ${existingPlan.rows[0].title}`,
      "lesson_plan",
      lessonPlanId,
      existingPlan.rows[0].title,
      ipAddress,
      userAgent
    );

    // Delete file if exists (no local delete; FTP delete optional if needed)
    // Note: Not deleting remote files here to keep history; can add FTP delete if required.

    await pool.query(
      "DELETE FROM lesson_plans WHERE id = $1 AND user_id = $2",
      [lessonPlanId, req.user.id]
    );

    await logChanges(
      "lesson_plans",
      lessonPlanId,
      ChangeTypes.delete,
      req.user
    );
    res.json({ message: "Lesson plan deleted successfully" });
  } catch (error) {
    console.error("Error deleting lesson plan:", error);
    res.status(500).json({ error: "Failed to delete lesson plan" });
  }
});

// Review lesson plan (admin only)
router.put("/:id/review", authenticateToken, async (req, res) => {
  try {
    if (!REVIEW_ROLES.includes(req.user.role)) {
      return res.status(403).json({
        error: isAdmin3(req.user)
          ? "Admin3 cannot approve or reject lesson plans."
          : "Access denied",
      });
    }

    const lessonPlanId = parseInt(req.params.id);
    const { status, admin_comment } = req.body;
    const ipAddress = req.ip || req.connection.remoteAddress;
    const userAgent = req.get("User-Agent");

    if (!["approved", "rejected", "pending"].includes(status)) {
      return res.status(400).json({ error: "Invalid status" });
    }

    // Get lesson plan details for logging
    const planResult = await pool.query(
      "SELECT * FROM lesson_plans WHERE id = $1",
      [lessonPlanId]
    );

    if (planResult.rows.length === 0) {
      return res.status(404).json({ error: "Lesson plan not found" });
    }

    const result = await pool.query(
      `UPDATE lesson_plans SET 
        status = $1, admin_comment = $2, reviewed_at = CURRENT_TIMESTAMP, reviewed_by = $3
       WHERE id = $4 RETURNING *`,
      [status, admin_comment, req.user.id, lessonPlanId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Lesson plan not found" });
    }

    // Log the activity
    const planTitle = planResult.rows[0]?.title || "Unknown";
    await logUserActivity(
      req.user.id,
      "update",
      `${status} lesson plan: ${planTitle}`,
      "lesson_plan",
      lessonPlanId,
      planTitle,
      ipAddress,
      userAgent
    );

    const fieldsChanged = {};
    const old = planResult.rows[0];
    const updated = result.rows[0];
    if (old.status !== updated.status)
      fieldsChanged.status = { before: old.status, after: updated.status };
    if (old.admin_comment !== updated.admin_comment)
      fieldsChanged.admin_comment = {
        before: old.admin_comment,
        after: updated.admin_comment,
      };
    if (old.reviewed_by !== updated.reviewed_by)
      fieldsChanged.reviewed_by = {
        before: old.reviewed_by,
        after: updated.reviewed_by,
      };
    await logChanges(
      "lesson_plans",
      lessonPlanId,
      ChangeTypes.update,
      req.user,
      fieldsChanged
    );
    res.json(result.rows[0]);
  } catch (error) {
    console.error("Error reviewing lesson plan:", error);
    res.status(500).json({ error: "Failed to review lesson plan" });
  }
});

// Delete lesson plan (admin only)
router.delete("/:id/admin", authenticateToken, async (req, res) => {
  try {
    if (!ADMIN_DELETE_ROLES.includes(req.user.role)) {
      return res.status(403).json({
        error: isAdmin3(req.user)
          ? "Admin3 cannot delete lesson plans."
          : "Access denied",
      });
    }

    const lessonPlanId = parseInt(req.params.id);
    const ipAddress = req.ip || req.connection.remoteAddress;
    const userAgent = req.get("User-Agent");

    // Get lesson plan details
    const existingPlan = await pool.query(
      "SELECT * FROM lesson_plans WHERE id = $1",
      [lessonPlanId]
    );

    if (existingPlan.rows.length === 0) {
      return res.status(404).json({ error: "Lesson plan not found" });
    }

    // Log the activity before deletion
    await logUserActivity(
      req.user.id,
      "delete",
      `Admin deleted lesson plan: ${existingPlan.rows[0].title}`,
      "lesson_plan",
      lessonPlanId,
      existingPlan.rows[0].title,
      ipAddress,
      userAgent
    );

    // Delete file if exists (no local delete; FTP delete optional if needed)
    // Note: Not deleting remote files here to keep history; can add FTP delete if required.

    await pool.query("DELETE FROM lesson_plans WHERE id = $1", [lessonPlanId]);

    await logChanges(
      "lesson_plans",
      lessonPlanId,
      ChangeTypes.delete,
      req.user
    );
    res.json({ message: "Lesson plan deleted successfully" });
  } catch (error) {
    console.error("Error deleting lesson plan:", error);
    res.status(500).json({ error: "Failed to delete lesson plan" });
  }
});

// Test endpoint to check if everything is working
router.get("/test", authenticateToken, async (req, res) => {
  try {
    if (!ADMIN_LIST_ROLES.includes(req.user.role)) {
      return res.status(403).json({ error: "Access denied" });
    }

    // Get total count
    const countResult = await pool.query("SELECT COUNT(*) FROM lesson_plans");
    const totalCount = countResult.rows[0].count;

    // Get all plans
    const plansResult = await pool.query(
      "SELECT * FROM lesson_plans ORDER BY submitted_at DESC"
    );

    res.json({
      message: "Test successful",
      totalLessonPlans: totalCount,
      lessonPlans: plansResult.rows,
      userRole: req.user.role,
      userId: req.user.id,
    });
  } catch (error) {
    console.error("Test endpoint error:", error);
    res.status(500).json({ error: "Test failed", details: error.message });
  }
});

module.exports = router;
