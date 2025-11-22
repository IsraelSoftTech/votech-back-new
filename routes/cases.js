const express = require("express");
const { Pool } = require("pg");
const puppeteer = require("puppeteer");
const fs = require("fs");
const path = require("path");
const router = express.Router();
require("dotenv").config();

const { ChangeTypes, logChanges } = require("../src/utils/logChanges.util");

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
    const user = jwt.verify(token, process.env.JWT_SECRET || "your-secret-key");
    req.user = user;
    next();
  } catch (err) {
    return res.status(403).json({ error: "Invalid token" });
  }
};

// Generate unique case number
const generateCaseNumber = async () => {
  const result = await pool.query("SELECT COUNT(*) FROM cases");
  const count = parseInt(result.rows[0].count) + 1;
  return `CASE${new Date().getFullYear()}${count.toString().padStart(4, "0")}`;
};

// Get all cases
router.get("/", authenticateToken, async (req, res) => {
  try {
    const query = `
      SELECT 
        c.*,
        s.full_name as student_name,
        s.student_id,
        cl.name as class_name,
        u.name as assigned_to_name,
        creator.name as created_by_name
      FROM cases c
      LEFT JOIN students s ON c.student_id = s.student_id
      LEFT JOIN classes cl ON c.class_id = cl.id
      LEFT JOIN users u ON c.assigned_to = u.id
      LEFT JOIN users creator ON c.created_by = creator.id
      ORDER BY c.created_at DESC
    `;
    const result = await pool.query(query);
    res.json(result.rows);
  } catch (error) {
    console.error("Error fetching cases:", error);
    res.status(500).json({ error: "Failed to fetch cases" });
  }
});

// Get case by ID
router.get("/:id", authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const query = `
      SELECT 
        c.*,
        s.full_name as student_name,
        s.student_id,
        cl.name as class_name,
        u.name as assigned_to_name,
        creator.name as created_by_name
      FROM cases c
      LEFT JOIN students s ON c.student_id = s.student_id
      LEFT JOIN classes cl ON c.class_id = cl.id
      LEFT JOIN users u ON c.assigned_to = u.id
      LEFT JOIN users creator ON c.created_by = creator.id
      WHERE c.id = $1
    `;
    const result = await pool.query(query, [id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Case not found" });
    }
    res.json(result.rows[0]);
  } catch (error) {
    console.error("Error fetching case:", error);
    res.status(500).json({ error: "Failed to fetch case" });
  }
});

// Create new case
router.post("/", authenticateToken, async (req, res) => {
  try {
    const {
      student_id,
      class_id,
      issue_type,
      issue_description,
      priority,
      notes,
    } = req.body;

    const caseNumber = await generateCaseNumber();

    const query = `
      INSERT INTO cases (
        case_number, student_id, class_id, issue_type, issue_description, 
        priority, assigned_to, created_by, started_date, notes
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
      RETURNING *
    `;

    const values = [
      caseNumber,
      student_id,
      class_id,
      issue_type,
      issue_description,
      priority || "medium",
      req.user.id, // assigned_to
      req.user.id, // created_by
      new Date().toISOString().split("T")[0], // started_date
      notes,
    ];

    const result = await pool.query(query, values);
    await logChanges("cases", result.rows[0].id, ChangeTypes.create, req.user);
    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error("Error creating case:", error);
    res.status(500).json({ error: "Failed to create case" });
  }
});

// Update case
router.put("/:id", authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const {
      issue_type,
      issue_description,
      status,
      priority,
      notes,
      resolved_date,
    } = req.body;

    const oldRecord = await pool.query("SELECT * FROM cases WHERE id = $1", [
      id,
    ]);
    if (oldRecord.rows.length === 0) {
      return res.status(404).json({ error: "Case not found" });
    }

    const query = `
      UPDATE cases 
      SET 
        issue_type = COALESCE($1, issue_type),
        issue_description = COALESCE($2, issue_description),
        status = COALESCE($3, status),
        priority = COALESCE($4, priority),
        notes = COALESCE($5, notes),
        resolved_date = COALESCE($6, resolved_date),
        updated_at = CURRENT_TIMESTAMP
      WHERE id = $7
      RETURNING *
    `;

    const values = [
      issue_type,
      issue_description,
      status,
      priority,
      notes,
      resolved_date,
      id,
    ];

    const result = await pool.query(query, values);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Case not found" });
    }
    const fieldsChanged = {};
    const old = oldRecord.rows[0];
    const updated = result.rows[0];
    if (old.issue_type !== updated.issue_type)
      fieldsChanged.issue_type = {
        before: old.issue_type,
        after: updated.issue_type,
      };
    if (old.issue_description !== updated.issue_description)
      fieldsChanged.issue_description = {
        before: old.issue_description,
        after: updated.issue_description,
      };
    if (old.status !== updated.status)
      fieldsChanged.status = { before: old.status, after: updated.status };
    if (old.priority !== updated.priority)
      fieldsChanged.priority = {
        before: old.priority,
        after: updated.priority,
      };
    if (old.notes !== updated.notes)
      fieldsChanged.notes = { before: old.notes, after: updated.notes };
    if (old.resolved_date !== updated.resolved_date)
      fieldsChanged.resolved_date = {
        before: old.resolved_date,
        after: updated.resolved_date,
      };
    await logChanges("cases", id, ChangeTypes.update, req.user, fieldsChanged);
    res.json(result.rows[0]);
  } catch (error) {
    console.error("Error updating case:", error);
    res.status(500).json({ error: "Failed to update case" });
  }
});

// Delete case
router.delete("/:id", authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query(
      "DELETE FROM cases WHERE id = $1 RETURNING *",
      [id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Case not found" });
    }
    await logChanges("cases", id, ChangeTypes.delete, req.user);
    res.json({ message: "Case deleted successfully" });
  } catch (error) {
    console.error("Error deleting case:", error);
    res.status(500).json({ error: "Failed to delete case" });
  }
});

// Get case sessions
router.get("/:id/sessions", authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const query = `
      SELECT cs.*, u.name as created_by_name
      FROM case_sessions cs
      LEFT JOIN users u ON cs.created_by = u.id
      WHERE cs.case_id = $1
      ORDER BY cs.session_date DESC, cs.session_time DESC
    `;
    const result = await pool.query(query, [id]);
    res.json(result.rows);
  } catch (error) {
    console.error("Error fetching case sessions:", error);
    res.status(500).json({ error: "Failed to fetch case sessions" });
  }
});

// Create case session
router.post("/:id/sessions", authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { session_date, session_time, session_type, session_notes } =
      req.body;

    const query = `
      INSERT INTO case_sessions (
        case_id, session_date, session_time, session_type, session_notes, created_by
      ) VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING *
    `;

    const values = [
      id,
      session_date,
      session_time,
      session_type,
      session_notes,
      req.user.id,
    ];

    const result = await pool.query(query, values);

    // Update case session counts
    await pool.query(
      `
      UPDATE cases 
      SET sessions_scheduled = sessions_scheduled + 1
      WHERE id = $1
    `,
      [id]
    );

    await logChanges(
      "case_sessions",
      result.rows[0].id,
      ChangeTypes.create,
      req.user
    );
    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error("Error creating case session:", error);
    res.status(500).json({ error: "Failed to create case session" });
  }
});

// Update case session
router.put("/sessions/:sessionId", authenticateToken, async (req, res) => {
  try {
    const { sessionId } = req.params;
    const { session_date, session_time, session_type, session_notes, status } =
      req.body;

    const oldRecord = await pool.query(
      "SELECT * FROM case_sessions WHERE id = $1",
      [sessionId]
    );
    if (oldRecord.rows.length === 0) {
      return res.status(404).json({ error: "Session not found" });
    }

    const query = `
      UPDATE case_sessions 
      SET 
        session_date = COALESCE($1, session_date),
        session_time = COALESCE($2, session_time),
        session_type = COALESCE($3, session_type),
        session_notes = COALESCE($4, session_notes),
        status = COALESCE($5, status),
        updated_at = CURRENT_TIMESTAMP
      WHERE id = $6
      RETURNING *
    `;

    const values = [
      session_date,
      session_time,
      session_type,
      session_notes,
      status,
      sessionId,
    ];

    const result = await pool.query(query, values);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Session not found" });
    }
    const fieldsChanged = {};
    const old = oldRecord.rows[0];
    const updated = result.rows[0];
    if (old.session_date !== updated.session_date)
      fieldsChanged.session_date = {
        before: old.session_date,
        after: updated.session_date,
      };
    if (old.session_time !== updated.session_time)
      fieldsChanged.session_time = {
        before: old.session_time,
        after: updated.session_time,
      };
    if (old.session_type !== updated.session_type)
      fieldsChanged.session_type = {
        before: old.session_type,
        after: updated.session_type,
      };
    if (old.session_notes !== updated.session_notes)
      fieldsChanged.session_notes = {
        before: old.session_notes,
        after: updated.session_notes,
      };
    if (old.status !== updated.status)
      fieldsChanged.status = { before: old.status, after: updated.status };
    await logChanges(
      "case_sessions",
      sessionId,
      ChangeTypes.update,
      req.user,
      fieldsChanged
    );
    res.json(result.rows[0]);
  } catch (error) {
    console.error("Error updating case session:", error);
    res.status(500).json({ error: "Failed to update case session" });
  }
});

// Delete case session
router.delete("/sessions/:sessionId", authenticateToken, async (req, res) => {
  try {
    const { sessionId } = req.params;
    const result = await pool.query(
      "DELETE FROM case_sessions WHERE id = $1 RETURNING *",
      [sessionId]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Session not found" });
    }
    await logChanges("case_sessions", sessionId, ChangeTypes.delete, req.user);
    res.json({ message: "Session deleted successfully" });
  } catch (error) {
    console.error("Error deleting case session:", error);
    res.status(500).json({ error: "Failed to delete case session" });
  }
});

// Send case report
router.post("/:id/send-report", authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { report_type, report_content, sent_to } = req.body;

    console.log("Starting report generation for case:", id);

    // Get comprehensive case details
    const caseQuery = `
      SELECT 
        c.*,
        s.full_name as student_name,
        s.student_id,
        s.date_of_birth,
        s.father_name,
        s.mother_name,
        s.guardian_contact,
        cl.name as class_name,
        u.name as assigned_to_name,
        creator.name as created_by_name
      FROM cases c
      LEFT JOIN students s ON c.student_id = s.student_id
      LEFT JOIN classes cl ON c.class_id = cl.id
      LEFT JOIN users u ON c.assigned_to = u.id
      LEFT JOIN users creator ON c.created_by = creator.id
      WHERE c.id = $1
    `;
    const caseResult = await pool.query(caseQuery, [id]);
    if (caseResult.rows.length === 0) {
      return res.status(404).json({ error: "Case not found" });
    }

    const caseData = caseResult.rows[0];
    console.log("Case data retrieved:", caseData.case_number);

    // Get case sessions
    const sessionsQuery = `
      SELECT cs.*, u.name as created_by_name
      FROM case_sessions cs
      LEFT JOIN users u ON cs.created_by = u.id
      WHERE cs.case_id = $1
      ORDER BY cs.session_date DESC, cs.session_time DESC
    `;
    const sessionsResult = await pool.query(sessionsQuery, [id]);
    const sessions = sessionsResult.rows;
    console.log("Sessions retrieved:", sessions.length);

    // Generate comprehensive text report
    const reportText = generateTextReport(
      caseData,
      sessions,
      report_type,
      report_content
    );

    // Create report record
    const reportQuery = `
      INSERT INTO case_reports (
        case_id, report_type, report_content, sent_to, sent_by
      ) VALUES ($1, $2, $3, $4, $5)
      RETURNING *
    `;

    const reportValues = [
      id,
      report_type,
      report_content,
      sent_to,
      req.user.id,
    ];

    const reportResult = await pool.query(reportQuery, reportValues);
    console.log("Report record created:", reportResult.rows[0].id);

    // Send comprehensive report message to admin
    const messageQuery = `
      INSERT INTO messages (sender_id, receiver_id, content)
      VALUES ($1, $2, $3)
    `;

    await pool.query(messageQuery, [req.user.id, sent_to, reportText]);
    console.log("Comprehensive report sent to admin");

    await logChanges(
      "case_reports",
      reportResult.rows[0].id,
      ChangeTypes.create,
      req.user
    );
    res.json({
      message: "Report sent successfully",
      report: reportResult.rows[0],
    });
  } catch (error) {
    console.error("Error sending case report:", error);
    res.status(500).json({
      error: "Failed to send case report",
      details: error.message,
    });
  }
});

// Function to generate comprehensive text report
function generateTextReport(caseData, sessions, reportType, reportContent) {
  const currentDate = new Date().toLocaleDateString();
  const currentTime = new Date().toLocaleTimeString();

  let report = `📋 CASE REPORT - ${caseData.case_number}\n`;
  report += `Generated: ${currentDate} at ${currentTime}\n`;
  report += `Report Type: ${reportType}\n`;
  report += `Generated by: ${caseData.created_by_name || "System"}\n`;
  report += `\n${"=".repeat(50)}\n\n`;

  // Case Information
  report += `🏫 CASE INFORMATION\n`;
  report += `${"─".repeat(30)}\n`;
  report += `Case Number: ${caseData.case_number}\n`;
  report += `Status: ${caseData.status.toUpperCase()}\n`;
  report += `Priority: ${caseData.priority.toUpperCase()}\n`;
  report += `Started Date: ${new Date(
    caseData.started_date
  ).toLocaleDateString()}\n`;
  if (caseData.resolved_date) {
    report += `Resolved Date: ${new Date(
      caseData.resolved_date
    ).toLocaleDateString()}\n`;
  }
  report += `Sessions: ${caseData.sessions_completed} completed, ${caseData.sessions_scheduled} scheduled\n`;
  report += `\n`;

  // Student Information
  report += `👤 STUDENT INFORMATION\n`;
  report += `${"─".repeat(30)}\n`;
  report += `Name: ${caseData.student_name || "N/A"}\n`;
  report += `Student ID: ${caseData.student_id || "N/A"}\n`;
  report += `Class: ${caseData.class_name || "N/A"}\n`;
  report += `Date of Birth: ${
    caseData.date_of_birth
      ? new Date(caseData.date_of_birth).toLocaleDateString()
      : "N/A"
  }\n`;
  report += `Father's Name: ${caseData.father_name || "N/A"}\n`;
  report += `Mother's Name: ${caseData.mother_name || "N/A"}\n`;
  report += `Guardian Contact: ${caseData.guardian_contact || "N/A"}\n`;
  report += `\n`;

  // Case Details
  report += `📝 CASE DETAILS\n`;
  report += `${"─".repeat(30)}\n`;
  report += `Issue Type: ${caseData.issue_type}\n`;
  report += `Issue Description:\n${caseData.issue_description}\n`;
  if (caseData.notes) {
    report += `\nCase Notes:\n${caseData.notes}\n`;
  }
  report += `\n`;

  // Counseling Sessions
  report += `📅 COUNSELING SESSIONS\n`;
  report += `${"─".repeat(30)}\n`;
  if (sessions.length > 0) {
    sessions.forEach((session, index) => {
      report += `${index + 1}. Session ${sessions.length - index}\n`;
      report += `   Date: ${new Date(
        session.session_date
      ).toLocaleDateString()}\n`;
      report += `   Time: ${session.session_time}\n`;
      report += `   Type: ${session.session_type}\n`;
      report += `   Status: ${session.status}\n`;
      if (session.session_notes) {
        report += `   Notes: ${session.session_notes}\n`;
      }
      report += `\n`;
    });
  } else {
    report += `No sessions scheduled yet.\n\n`;
  }

  // Additional Report Content
  report += `📋 ADDITIONAL REPORT CONTENT\n`;
  report += `${"─".repeat(30)}\n`;
  report += `${reportContent}\n`;
  report += `\n`;

  // Summary
  report += `📊 SUMMARY\n`;
  report += `${"─".repeat(30)}\n`;
  report += `Total Sessions: ${sessions.length}\n`;
  report += `Case Duration: ${Math.ceil(
    (new Date() - new Date(caseData.started_date)) / (1000 * 60 * 60 * 24)
  )} days\n`;
  report += `Current Status: ${caseData.status}\n`;
  report += `Priority Level: ${caseData.priority}\n`;
  report += `\n`;

  report += `${"=".repeat(50)}\n`;
  report += `End of Report\n`;
  report += `Report ID: ${caseData.case_number}_${Date.now()}`;

  return report;
}

// Get students for case creation
router.get("/students/list", authenticateToken, async (req, res) => {
  try {
    const query = `
      SELECT s.student_id, s.full_name, c.name as class_name, c.id as class_id
      FROM students s
      LEFT JOIN classes c ON s.class_id = c.id
      ORDER BY s.full_name
    `;
    const result = await pool.query(query);
    res.json(result.rows);
  } catch (error) {
    console.error("Error fetching students:", error);
    res.status(500).json({ error: "Failed to fetch students" });
  }
});

// Get classes for case creation
router.get("/classes/list", authenticateToken, async (req, res) => {
  try {
    const query = "SELECT id, name FROM classes ORDER BY name";
    const result = await pool.query(query);
    res.json(result.rows);
  } catch (error) {
    console.error("Error fetching classes:", error);
    res.status(500).json({ error: "Failed to fetch classes" });
  }
});

// Get admin users for sending reports
router.get("/admins/list", authenticateToken, async (req, res) => {
  try {
    // Query for only Admin1 users
    const query = `
      SELECT id, name, username, role 
      FROM users 
      WHERE role = 'Admin1'
      ORDER BY name
    `;
    const result = await pool.query(query);
    // Found Admin1 users
    res.json(result.rows);
  } catch (error) {
    console.error("Error fetching Admin1 users:", error);
    res.status(500).json({ error: "Failed to fetch Admin1 users" });
  }
});

module.exports = router;
