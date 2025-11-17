const express = require("express");
const multer = require("multer");
const path = require("path");
const fs = require("fs");
const { Pool } = require("pg");
const ftpService = require("../ftp-service");
require("dotenv").config();

const { ChangeTypes, logChanges } = require("../src/utils/logChanges.util");

const db =
  process.env.NODE_ENV === "desktop"
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

    // Lesson plans table initialized with correct schema
  } catch (error) {
    console.error("Error initializing lesson plans table:", error);
  }
};

// Initialize table on module load
initializeLessonPlansTable();

// Upload a new lesson plan
router.post("/", authenticateToken, upload.single("file"), async (req, res) => {
  try {
    const { title, period_type } = req.body;
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
      `INSERT INTO lesson_plans (user_id, title, period_type, file_url) 
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [req.user.id, title, period_type || "weekly", fileUrl]
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

    // Check if user is admin or dean
    if (
      !["Admin1", "Admin2", "Admin3", "Admin4", "admin", "Dean"].includes(
        req.user.role
      )
    ) {
      return res.status(403).json({ error: "Access denied" });
    }

    // Simple query to get all lesson plans with user info
    const result = await pool.query(
      `SELECT 
        lp.*,
        u.name as teacher_name,
        u.username as teacher_username,
        u.role as teacher_role
       FROM lesson_plans lp 
       LEFT JOIN users u ON lp.user_id = u.id 
       ORDER BY lp.submitted_at DESC`
    );

    console.log("Found", result.rows.length, "lesson plans");
    res.json(result.rows);
  } catch (error) {
    console.error("Error fetching all lesson plans:", error);
    res.status(500).json({ error: "Failed to fetch all lesson plans" });
  }
});

// Update a lesson plan
router.put(
  "/:id",
  authenticateToken,
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
router.delete("/:id", authenticateToken, async (req, res) => {
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
    // Check if user is admin or dean
    if (
      !["Admin1", "Admin2", "Admin3", "Admin4", "admin", "Dean"].includes(
        req.user.role
      )
    ) {
      return res.status(403).json({ error: "Access denied" });
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
    // Check if user is admin or dean
    if (
      !["Admin1", "Admin2", "Admin3", "Admin4", "admin", "Dean"].includes(
        req.user.role
      )
    ) {
      return res.status(403).json({ error: "Access denied" });
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
    // Check if user is admin or dean
    if (
      !["Admin1", "Admin2", "Admin3", "Admin4", "admin", "Dean"].includes(
        req.user.role
      )
    ) {
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
