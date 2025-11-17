const express = require("express");
const { ChangeTypes, logChanges } = require("../src/utils/logChanges.util");

module.exports = function createAttendanceRouter(pool, authenticateToken) {
  const router = express.Router();

  router.get("/classes", authenticateToken, async (req, res) => {
    try {
      const result = await pool.query(
        "SELECT id, name FROM classes ORDER BY name ASC"
      );
      res.json(result.rows);
    } catch (error) {
      console.error("Error fetching classes:", error);
      res.status(500).json({ error: "Failed to fetch classes" });
    }
  });

  router.get("/:classId/students", authenticateToken, async (req, res) => {
    const { classId } = req.params;
    try {
      const result = await pool.query(
        "SELECT id, full_name, sex FROM students WHERE class_id = $1 ORDER BY full_name ASC",
        [classId]
      );
      res.json(result.rows);
    } catch (error) {
      console.error("Error fetching students for class:", error);
      res.status(500).json({ error: "Failed to fetch students" });
    }
  });

  router.post("/start", authenticateToken, async (req, res) => {
    const { type, class_id, session_time } = req.body;
    if (!type || type !== "student") {
      return res.status(400).json({ error: "Invalid type. Must be student" });
    }
    try {
      const result = await pool.query(
        `INSERT INTO attendance_sessions (type, class_id, taken_by, session_time)
         VALUES (LOWER($1), $2, $3, COALESCE($4, NOW())) RETURNING *`,
        [type, class_id || null, req.user.id || null, session_time || null]
      );
      const session = result.rows[0];
      await logChanges(
        "attendance_sessions",
        session.id,
        ChangeTypes.create,
        req.user,
        session
      );
      res.status(201).json(session);
    } catch (error) {
      console.error("Error starting attendance session:", error);
      res.status(500).json({ error: "Failed to start session" });
    }
  });

  router.post("/:sessionId/mark-bulk", authenticateToken, async (req, res) => {
    const { sessionId } = req.params;
    const { records } = req.body;
    if (!Array.isArray(records) || records.length === 0) {
      return res
        .status(400)
        .json({ error: "records must be a non-empty array" });
    }

    const sessionResult = await pool.query(
      "SELECT type FROM attendance_sessions WHERE id = $1",
      [sessionId]
    );
    if (sessionResult.rows.length === 0) {
      return res.status(404).json({ error: "Session not found" });
    }
    const sessionType = sessionResult.rows[0].type;

    if (sessionType !== "student") {
      return res
        .status(400)
        .json({ error: "Only student attendance is supported" });
    }

    const valid = records.every(
      (r) => r && r.student_id && ["present", "absent"].includes(r.status)
    );
    if (!valid) {
      return res.status(400).json({ error: "Invalid records data" });
    }

    try {
      await pool.query("BEGIN");
      const insertText = `
        INSERT INTO attendance_records (session_id, student_id, status)
        VALUES ($1, $2, $3)
        ON CONFLICT (session_id, student_id)
        DO UPDATE SET status = EXCLUDED.status, marked_at = NOW()
        RETURNING *
      `;
      for (const r of records) {
        const upsertResult = await pool.query(insertText, [
          sessionId,
          r.student_id,
          r.status,
        ]);
        const record = upsertResult.rows[0];
        const changeType =
          record.marked_at === record.created_at
            ? ChangeTypes.create
            : ChangeTypes.update;
        await logChanges(
          "attendance_records",
          record.id,
          changeType,
          req.user,
          record
        );
      }
      await pool.query("COMMIT");
      res.json({ message: "Attendance saved" });
    } catch (error) {
      await pool.query("ROLLBACK");
      console.error("Error saving attendance:", error);
      res.status(500).json({ error: "Failed to save attendance" });
    }
  });

  router.get("/today-summary", authenticateToken, async (req, res) => {
    try {
      const summaryQuery = `
        WITH recent_sessions AS (
          SELECT id, type FROM attendance_sessions
          WHERE session_time >= NOW() - INTERVAL '7 days'
          AND type = 'student'
        )
        SELECT
          COALESCE(SUM(CASE WHEN ar.status = 'present' THEN 1 ELSE 0 END), 0) AS student_present,
          COALESCE(SUM(CASE WHEN ar.status = 'absent' THEN 1 ELSE 0 END), 0) AS student_absent
        FROM recent_sessions rs
        LEFT JOIN attendance_records ar ON ar.session_id = rs.id
      `;
      const result = await pool.query(summaryQuery);
      const row = result.rows[0] || {};
      const summary = {
        students: {
          present: Number(row.student_present || 0),
          absent: Number(row.student_absent || 0),
        },
        teachers: { present: 0, absent: 0 },
      };
      res.json(summary);
    } catch (error) {
      console.error("Error fetching today summary:", error);
      res.status(500).json({ error: "Failed to fetch summary" });
    }
  });

  router.get("/today-sessions", authenticateToken, async (req, res) => {
    try {
      const result = await pool.query(
        `SELECT s.id, LOWER(s.type) as type, s.session_time, c.name as class_name
         FROM attendance_sessions s
         LEFT JOIN classes c ON s.class_id = c.id
         WHERE s.session_time >= NOW() - INTERVAL '7 days'
         AND s.type = 'student'
         ORDER BY s.session_time DESC`
      );
      res.json(result.rows);
    } catch (error) {
      console.error("Error fetching recent sessions:", error);
      res.status(500).json({ error: "Failed to fetch recent sessions" });
    }
  });

  router.get("/export", authenticateToken, async (req, res) => {
    try {
      const type = String(req.query.type || "").toLowerCase();
      const classId = req.query.classId ? Number(req.query.classId) : null;
      const date = req.query.date;

      if (type !== "student")
        return res
          .status(400)
          .json({ error: "Only student attendance export is supported" });
      if (!date)
        return res.status(400).json({ error: "date is required (YYYY-MM-DD)" });
      if (!classId)
        return res
          .status(400)
          .json({ error: "classId is required for student attendance" });

      const sessionsQuery = `
        SELECT id, session_time, class_id 
        FROM attendance_sessions 
        WHERE type = $1 
        AND session_time >= $2::timestamp 
        AND session_time < $2::timestamp + INTERVAL '1 day'
        AND class_id = $3
        ORDER BY session_time ASC
      `;
      const sessionsResult = await pool.query(sessionsQuery, [
        type,
        date,
        classId,
      ]);
      const sessions = sessionsResult.rows;
      if (sessions.length === 0)
        return res.json({
          type,
          date,
          className: "N/A",
          sessions: [],
          rows: [],
        });

      const classResult = await pool.query(
        "SELECT name FROM classes WHERE id = $1",
        [classId]
      );
      const className = classResult.rows[0]?.name || "Unknown Class";
      const studentsResult = await pool.query(
        "SELECT id, full_name, sex FROM students WHERE class_id = $1 ORDER BY full_name ASC",
        [classId]
      );
      const people = studentsResult.rows;

      const sessionIds = sessions.map((s) => s.id);
      const recordsQuery = `SELECT session_id, student_id, status FROM attendance_records WHERE session_id = ANY($1)`;
      const recordsResult = await pool.query(recordsQuery, [sessionIds]);
      const records = recordsResult.rows;

      const sessionTimes = sessions.map((s) =>
        new Date(s.session_time).toLocaleTimeString([], {
          hour: "2-digit",
          minute: "2-digit",
        })
      );
      const rows = people.map((person) => {
        const statuses = sessions.map((session) => {
          const record = records.find(
            (r) => r.student_id === person.id && r.session_id === session.id
          );
          return record ? (record.status === "present" ? "P" : "A") : "";
        });
        return {
          id: person.id,
          full_name: person.full_name,
          sex: person.sex,
          statuses,
          total_present: statuses.filter((s) => s === "P").length,
          total_absent: statuses.filter((s) => s === "A").length,
        };
      });

      res.json({ type, date, className, sessions: sessionTimes, rows });
    } catch (error) {
      console.error("Error exporting attendance:", error);
      res.status(500).json({ error: "Failed to export attendance" });
    }
  });

  router.delete("/all", authenticateToken, async (req, res) => {
    try {
      const records = await pool.query("SELECT * FROM attendance_records");
      const sessions = await pool.query("SELECT * FROM attendance_sessions");
      await pool.query("BEGIN");
      await pool.query("DELETE FROM attendance_records");
      await pool.query("DELETE FROM attendance_sessions");
      await pool.query("COMMIT");

      for (const r of records.rows)
        await logChanges(
          "attendance_records",
          r.id,
          ChangeTypes.delete,
          req.user,
          r
        );
      for (const s of sessions.rows)
        await logChanges(
          "attendance_sessions",
          s.id,
          ChangeTypes.delete,
          req.user,
          s
        );

      res.json({ message: "All attendance deleted" });
    } catch (error) {
      await pool.query("ROLLBACK");
      console.error("Error deleting all attendance:", error);
      res.status(500).json({ error: "Failed to delete attendance" });
    }
  });

  return router;
};
