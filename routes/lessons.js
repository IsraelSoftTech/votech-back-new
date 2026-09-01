const express = require("express");
const { Pool } = require("pg");
require("dotenv").config();

const { ChangeTypes, logChanges } = require("../src/utils/logChanges.util");

const router = express.Router();
const isDesktop = process.env.NODE_ENV === "desktop";
const db = isDesktop
  ? process.env.DATABASE_URL_LOCAL
  : process.env.DATABASE_URL;

const pool = new Pool({
  connectionString: db,
});

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

const buildLessonListQuery = (req) => {
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
    conditions.push(`l.status = 'approved'`);
  } else if (status && status !== "all") {
    params.push(status);
    conditions.push(`l.status = $${params.length}`);
  }

  if (classFilter) {
    const classId = parseInt(classFilter, 10);
    if (!Number.isNaN(classId)) {
      params.push(classId);
      const idx = params.length;
      conditions.push(`(
        l.class_id = $${idx}
        OR EXISTS (
          SELECT 1 FROM class_subjects cs
          WHERE cs.teacher_id = l.user_id AND cs.class_id = $${idx}
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
        l.department_id = $${idx}
        OR c.department_id = $${idx}
        OR EXISTS (
          SELECT 1 FROM class_subjects cs
          WHERE cs.teacher_id = l.user_id AND cs.department_id = $${idx}
        )
      )`);
    }
  }

  if (search && String(search).trim()) {
    params.push(`%${String(search).trim().toLowerCase()}%`);
    const idx = params.length;
    conditions.push(`(
      LOWER(l.title) LIKE $${idx}
      OR LOWER(COALESCE(l.subject, '')) LIKE $${idx}
      OR LOWER(COALESCE(l.class_name, '')) LIKE $${idx}
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
      l.*,
      u.name AS teacher_name,
      u.username AS teacher_username,
      u.role AS teacher_role,
      c.name AS class_label,
      COALESCE(sp.name, sp2.name) AS department_name
    FROM lessons l
    LEFT JOIN users u ON l.user_id = u.id
    LEFT JOIN classes c ON l.class_id = c.id
    LEFT JOIN specialties sp ON l.department_id = sp.id
    LEFT JOIN specialties sp2 ON c.department_id = sp2.id
    ${whereClause}
    ORDER BY l.created_at DESC NULLS LAST, l.id DESC
    LIMIT $${limitIdx} OFFSET $${offsetIdx}
  `;

  const countSql = `
    SELECT COUNT(*)::int AS total
    FROM lessons l
    LEFT JOIN users u ON l.user_id = u.id
    LEFT JOIN classes c ON l.class_id = c.id
    ${whereClause}
  `;

  return { sql, countSql, params, pageNum, limitNum };
};

// Initialize lessons table
const initializeLessonsTable = async () => {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS lessons (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        title VARCHAR(255) NOT NULL,
        subject VARCHAR(100),
        class_name VARCHAR(100),
        week VARCHAR(50),
        period_type VARCHAR(20) NOT NULL DEFAULT 'weekly' CHECK (period_type IN ('weekly', 'monthly', 'yearly')),
        objectives TEXT,
        content TEXT,
        activities TEXT,
        assessment TEXT,
        resources TEXT,
        status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
        admin_comment TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        reviewed_at TIMESTAMP,
        reviewed_by INTEGER REFERENCES users(id) ON DELETE SET NULL
      )
    `);

    await pool.query(`
      ALTER TABLE lessons
        ADD COLUMN IF NOT EXISTS class_id INTEGER REFERENCES classes(id) ON DELETE SET NULL,
        ADD COLUMN IF NOT EXISTS department_id INTEGER REFERENCES specialties(id) ON DELETE SET NULL
    `);

    // Lessons table initialized
  } catch (error) {
    console.error("Error initializing lessons table:", error);
  }
};

// Initialize table on module load
initializeLessonsTable();

// Create a new lesson
router.post("/", authenticateToken, denyAdmin3Write, async (req, res) => {
  try {
    const {
      title,
      subject,
      class_name,
      class_id,
      department_id,
      week,
      period_type,
      objectives,
      content,
      activities,
      assessment,
      resources,
    } = req.body;

    if (!title) {
      return res.status(400).json({ error: "Title is required" });
    }

    const result = await pool.query(
      `INSERT INTO lessons 
       (user_id, title, subject, class_name, class_id, department_id, week, period_type, objectives, content, activities, assessment, resources) 
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13) 
       RETURNING *`,
      [
        req.user.id,
        title,
        subject,
        class_name,
        class_id ? parseInt(class_id, 10) || null : null,
        department_id ? parseInt(department_id, 10) || null : null,
        week,
        period_type || "weekly",
        objectives,
        content,
        activities,
        assessment,
        resources,
      ]
    );

    await logChanges(
      "lessons",
      result.rows[0].id,
      ChangeTypes.create,
      req.user
    );
    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error("Error creating lesson:", error);
    res.status(500).json({ error: "Failed to create lesson" });
  }
});

// Get my lessons (for teachers)
router.get("/my", authenticateToken, async (req, res) => {
  try {
    const pageNum = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limitNum = Math.min(
      500,
      Math.max(1, parseInt(req.query.limit, 10) || 15)
    );
    const offset = (pageNum - 1) * limitNum;

    const [result, countResult] = await Promise.all([
      pool.query(
        "SELECT * FROM lessons WHERE user_id = $1 ORDER BY created_at DESC LIMIT $2 OFFSET $3",
        [req.user.id, limitNum, offset]
      ),
      pool.query(
        "SELECT COUNT(*)::int AS total FROM lessons WHERE user_id = $1",
        [req.user.id]
      ),
    ]);

    const total = countResult.rows[0]?.total ?? result.rows.length;

    res.json({
      items: result.rows,
      total,
      page: pageNum,
      limit: limitNum,
    });
  } catch (error) {
    console.error("Error fetching my lessons:", error);
    res.status(500).json({ error: "Failed to fetch lessons" });
  }
});

// Get all lessons (for admins)
router.get("/all", authenticateToken, async (req, res) => {
  try {
    console.log(
      "Get all lessons request from user:",
      req.user.id,
      "Role:",
      req.user.role
    );

    if (!ADMIN_LIST_ROLES.includes(req.user.role)) {
      return res.status(403).json({ error: "Access denied" });
    }

    const { sql, countSql, params, pageNum, limitNum } =
      buildLessonListQuery(req);
    const countParams = params.slice(0, params.length - 2);

    const [result, countResult] = await Promise.all([
      pool.query(sql, params),
      pool.query(countSql, countParams),
    ]);

    const total = countResult.rows[0]?.total ?? result.rows.length;
    console.log("Found", result.rows.length, "lessons (total:", total, ")");

    res.json({
      items: result.rows,
      total,
      page: pageNum,
      limit: limitNum,
    });
  } catch (error) {
    console.error("Error fetching all lessons:", error);
    res.status(500).json({ error: "Failed to fetch all lessons" });
  }
});

// Update a lesson
router.put("/:id", authenticateToken, denyAdmin3Write, async (req, res) => {
  try {
    const lessonId = parseInt(req.params.id);
    const {
      title,
      subject,
      class_name,
      week,
      period_type,
      objectives,
      content,
      activities,
      assessment,
      resources,
    } = req.body;

    // Check if lesson belongs to user or user is admin
    const existingLesson = await pool.query(
      "SELECT * FROM lessons WHERE id = $1",
      [lessonId]
    );

    if (existingLesson.rows.length === 0) {
      return res.status(404).json({ error: "Lesson not found" });
    }

    // Only allow owner or admin to edit
    if (
      existingLesson.rows[0].user_id !== req.user.id &&
      !["Admin1", "Admin2", "Admin4", "admin", "Dean"].includes(req.user.role)
    ) {
      return res.status(403).json({ error: "Access denied" });
    }

    const result = await pool.query(
      `UPDATE lessons SET 
        title = $1, subject = $2, class_name = $3, week = $4, 
        period_type = $5, objectives = $6, content = $7, 
        activities = $8, assessment = $9, resources = $10, 
        updated_at = CURRENT_TIMESTAMP
       WHERE id = $11 RETURNING *`,
      [
        title,
        subject,
        class_name,
        week,
        period_type || "weekly",
        objectives,
        content,
        activities,
        assessment,
        resources,
        lessonId,
      ]
    );

    const fieldsChanged = {};
    const old = existingLesson.rows[0];
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
    if (old.period_type !== updated.period_type)
      fieldsChanged.period_type = {
        before: old.period_type,
        after: updated.period_type,
      };
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
    await logChanges(
      "lessons",
      lessonId,
      ChangeTypes.update,
      req.user,
      fieldsChanged
    );
    res.json(result.rows[0]);
  } catch (error) {
    console.error("Error updating lesson:", error);
    res.status(500).json({ error: "Failed to update lesson" });
  }
});

// Delete a lesson
router.delete("/:id", authenticateToken, denyAdmin3Write, async (req, res) => {
  try {
    const lessonId = parseInt(req.params.id);

    // Check if lesson exists and user has permission
    const existingLesson = await pool.query(
      "SELECT * FROM lessons WHERE id = $1",
      [lessonId]
    );

    if (existingLesson.rows.length === 0) {
      return res.status(404).json({ error: "Lesson not found" });
    }

    // Only allow owner or admin to delete
    if (
      existingLesson.rows[0].user_id !== req.user.id &&
      !["Admin1", "Admin2", "Admin4", "admin", "Dean"].includes(req.user.role)
    ) {
      return res.status(403).json({ error: "Access denied" });
    }

    await pool.query("DELETE FROM lessons WHERE id = $1", [lessonId]);
    await logChanges("lessons", lessonId, ChangeTypes.delete, req.user);
    res.json({ message: "Lesson deleted successfully" });
  } catch (error) {
    console.error("Error deleting lesson:", error);
    res.status(500).json({ error: "Failed to delete lesson" });
  }
});

// Review lesson (admin only)
router.put("/:id/review", authenticateToken, async (req, res) => {
  try {
    if (!REVIEW_ROLES.includes(req.user.role)) {
      return res.status(403).json({
        error: isAdmin3(req.user)
          ? "Admin3 cannot approve or reject lesson plans."
          : "Access denied",
      });
    }

    const lessonId = parseInt(req.params.id);
    const { status, admin_comment } = req.body;

    if (!["approved", "rejected", "pending"].includes(status)) {
      return res.status(400).json({ error: "Invalid status" });
    }

    const existingLesson = await pool.query(
      "SELECT * FROM lessons WHERE id = $1",
      [lessonId]
    );

    if (existingLesson.rows.length === 0) {
      return res.status(404).json({ error: "Lesson not found" });
    }

    const result = await pool.query(
      `UPDATE lessons SET 
        status = $1, admin_comment = $2, reviewed_at = CURRENT_TIMESTAMP, reviewed_by = $3
       WHERE id = $4 RETURNING *`,
      [status, admin_comment, req.user.id, lessonId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Lesson not found" });
    }

    const fieldsChanged = {};
    const old = existingLesson.rows[0];
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
      "lessons",
      lessonId,
      ChangeTypes.update,
      req.user,
      fieldsChanged
    );
    res.json(result.rows[0]);
  } catch (error) {
    console.error("Error reviewing lesson:", error);
    res.status(500).json({ error: "Failed to review lesson" });
  }
});

module.exports = router;
