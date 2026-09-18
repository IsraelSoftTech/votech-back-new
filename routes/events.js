const express = require("express");
const router = express.Router();

const { ChangeTypes, logChanges } = require("../src/utils/logChanges.util");
const {
  resolveListYearId,
  getStampYearId,
  yearParam,
} = require("../src/utils/yearScopedQuery.util");

const ALL_SENTINEL = "__ALL__";

function parseSelectAllFlag(body) {
  if (!body) return false;
  if (body.selectAllUsers === true || body.selectAllUsers === "true") {
    return true;
  }
  const participants = body.participants;
  if (participants === ALL_SENTINEL) return true;
  if (
    Array.isArray(participants) &&
    participants.length === 1 &&
    participants[0] === ALL_SENTINEL
  ) {
    return true;
  }
  return false;
}

function participantsToCsv(value) {
  if (Array.isArray(value)) {
    return value
      .map((item) => String(item || "").trim())
      .filter(Boolean)
      .join(", ");
  }
  return value == null ? "" : String(value);
}

async function resolveParticipantsCsv(pool, body) {
  // Snapshot at create/update time. Users added later are not auto-included.
  if (parseSelectAllFlag(body)) {
    const { rows } = await pool.query(`
      SELECT username
      FROM users
      WHERE COALESCE(suspended, false) = false
        AND COALESCE(is_system, false) = false
        AND username IS NOT NULL
        AND TRIM(username) <> ''
      ORDER BY username
    `);
    return rows.map((row) => row.username).join(", ");
  }
  return participantsToCsv(body?.participants);
}

function decorateEvent(row) {
  if (!row) return row;
  const list = row.participants
    ? String(row.participants)
        .split(",")
        .map((name) => name.trim())
        .filter(Boolean)
    : [];
  return {
    ...row,
    participant_count: list.length,
    participants_list: list,
  };
}

function createEventsRouter(pool, authenticateToken) {
  router.get("/", authenticateToken, async (req, res) => {
    try {
      const yearId = yearParam(await resolveListYearId(req));
      const result = await pool.query(
        `
        SELECT e.*, u.username as created_by_name 
        FROM events e 
        LEFT JOIN users u ON e.created_by = u.id 
        WHERE e.academic_year_id = $1
        ORDER BY e.event_date DESC, e.event_time DESC
      `,
        [yearId]
      );
      res.json(result.rows.map(decorateEvent));
    } catch (error) {
      console.error("Error fetching events:", error);
      res.status(500).json({ error: "Failed to fetch events" });
    }
  });

  router.get("/users", authenticateToken, async (req, res) => {
    try {
      const allowedRoles = [
        "Admin1",
        "Admin2",
        "Admin3",
        "Admin4",
        "Discipline",
      ];
      if (!allowedRoles.includes(req.user.role)) {
        return res
          .status(403)
          .json({ error: "You are not authorized to list event users" });
      }

      const search = String(req.query.q || "").trim();
      const params = [];
      let where = "WHERE COALESCE(suspended, false) = false";
      if (search) {
        params.push(`%${search}%`);
        where += ` AND (name ILIKE $${params.length} OR username ILIKE $${params.length} OR COALESCE(role, '') ILIKE $${params.length})`;
      }

      const result = await pool.query(
        `
        SELECT id, name, username, role
        FROM users
        ${where}
        ORDER BY name, username
        `,
        params
      );
      res.json(result.rows);
    } catch (error) {
      console.error("Error fetching event users:", error);
      res.status(500).json({ error: "Failed to fetch users" });
    }
  });

  router.get("/range", authenticateToken, async (req, res) => {
    try {
      const { start_date, end_date } = req.query;

      if (!start_date || !end_date) {
        return res
          .status(400)
          .json({ error: "Start date and end date are required" });
      }

      const yearId = yearParam(await resolveListYearId(req));
      const result = await pool.query(
        `
        SELECT e.*, u.username as created_by_name 
        FROM events e 
        LEFT JOIN users u ON e.created_by = u.id 
        WHERE e.event_date >= $1 AND e.event_date <= $2
          AND e.academic_year_id = $3
        ORDER BY e.event_date ASC, e.event_time ASC
      `,
        [start_date, end_date, yearId]
      );
      res.json(result.rows.map(decorateEvent));
    } catch (error) {
      console.error("Error fetching events by range:", error);
      res.status(500).json({ error: "Failed to fetch events" });
    }
  });

  router.get("/my-events", authenticateToken, async (req, res) => {
    try {
      const yearId = yearParam(await resolveListYearId(req));
      const result = await pool.query(
        `
        SELECT e.*, u.username as created_by_name 
        FROM events e 
        LEFT JOIN users u ON e.created_by = u.id 
        WHERE (e.participants LIKE $1 OR e.participants LIKE $2 OR e.participants LIKE $3)
          AND e.academic_year_id = $4
        ORDER BY e.event_date ASC, e.event_time ASC
      `,
        [
          `%${req.user.username}%`,
          `${req.user.username},%`,
          `%,${req.user.username}%`,
          yearId,
        ]
      );

      res.json(result.rows.map(decorateEvent));
    } catch (error) {
      console.error("Error fetching user events:", error);
      res.status(500).json({ error: "Failed to fetch user events" });
    }
  });

  router.get("/upcoming", authenticateToken, async (req, res) => {
    try {
      const yearId = yearParam(await resolveListYearId(req));
      const result = await pool.query(
        `
        SELECT e.*, u.username as created_by_name 
        FROM events e 
        LEFT JOIN users u ON e.created_by = u.id 
        WHERE e.event_date >= CURRENT_DATE AND e.academic_year_id = $1
        ORDER BY e.event_date ASC, e.event_time ASC
        LIMIT 10
      `,
        [yearId]
      );
      res.json(result.rows.map(decorateEvent));
    } catch (error) {
      console.error("Error fetching upcoming events:", error);
      res.status(500).json({ error: "Failed to fetch upcoming events" });
    }
  });

  router.get("/stats", authenticateToken, async (req, res) => {
    try {
      const yearId = yearParam(await resolveListYearId(req));
      const totalResult = await pool.query(
        "SELECT COUNT(*) as total FROM events WHERE academic_year_id = $1",
        [yearId]
      );
      const upcomingResult = await pool.query(
        `
        SELECT COUNT(*) as upcoming 
        FROM events 
        WHERE event_date >= CURRENT_DATE AND academic_year_id = $1
      `,
        [yearId]
      );

      res.json({
        total: parseInt(totalResult.rows[0].total),
        upcoming: parseInt(upcomingResult.rows[0].upcoming),
      });
    } catch (error) {
      console.error("Error fetching event stats:", error);
      res.status(500).json({ error: "Failed to fetch event statistics" });
    }
  });

  router.post("/", authenticateToken, async (req, res) => {
    try {
      const allowedRoles = [
        "Admin1",
        "Admin2",
        "Admin3",
        "Admin4",
        "Discipline",
      ];
      if (!allowedRoles.includes(req.user.role)) {
        return res
          .status(403)
          .json({ error: "You are not authorized to create events" });
      }

      const { title, description, event_type, event_date, event_time } =
        req.body;
      const created_by = req.user.id;
      const participants = await resolveParticipantsCsv(pool, req.body);

      if (!title || !event_type || !event_date || !event_time) {
        return res
          .status(400)
          .json({ error: "Title, event type, date, and time are required" });
      }

      const validTypes = ["Meeting", "Class", "Others"];
      if (!validTypes.includes(event_type)) {
        return res.status(400).json({
          error: "Invalid event type. Must be Meeting, Class, or Others",
        });
      }

      const yearId = yearParam(await getStampYearId());
      const existingEvent = await pool.query(
        `
        SELECT id, title FROM events WHERE event_date = $1 AND academic_year_id = $2
      `,
        [event_date, yearId]
      );

      if (existingEvent.rows.length > 0) {
        return res.status(409).json({
          error:
            "An event already exists on this date. Only one event per day is allowed.",
          existingEvent: existingEvent.rows[0],
        });
      }

      const result = await pool.query(
        `
        INSERT INTO events (title, description, event_type, event_date, event_time, participants, created_by, academic_year_id)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        RETURNING *
      `,
        [
          title,
          description,
          event_type,
          event_date,
          event_time,
          participants,
          created_by,
          yearId,
        ]
      );

      await logChanges(
        "events",
        result.rows[0].id,
        ChangeTypes.create,
        req.user
      );
      res.status(201).json(decorateEvent(result.rows[0]));
    } catch (error) {
      console.error("Error creating event:", error);
      res.status(500).json({ error: "Failed to create event" });
    }
  });

  router.put("/:id", authenticateToken, async (req, res) => {
    try {
      const { id } = req.params;
      const { title, description, event_type, event_date, event_time } =
        req.body;
      const participants = await resolveParticipantsCsv(pool, req.body);

      const eventCheck = await pool.query(
        "SELECT * FROM events WHERE id = $1",
        [id]
      );
      if (eventCheck.rows.length === 0) {
        return res.status(404).json({ error: "Event not found" });
      }
      if (eventCheck.rows[0].created_by !== req.user.id) {
        return res
          .status(403)
          .json({ error: "You can only edit events you created" });
      }

      if (!title || !event_type || !event_date || !event_time) {
        return res
          .status(400)
          .json({ error: "Title, event type, date, and time are required" });
      }

      const validTypes = ["Meeting", "Class", "Others"];
      if (!validTypes.includes(event_type)) {
        return res.status(400).json({
          error: "Invalid event type. Must be Meeting, Class, or Others",
        });
      }

      const result = await pool.query(
        `
        UPDATE events 
        SET title = $1, description = $2, event_type = $3, event_date = $4, event_time = $5, participants = $6, updated_at = CURRENT_TIMESTAMP
        WHERE id = $7
        RETURNING *
      `,
        [
          title,
          description,
          event_type,
          event_date,
          event_time,
          participants,
          id,
        ]
      );

      if (result.rows.length === 0) {
        return res.status(404).json({ error: "Event not found" });
      }

      const fieldsChanged = {};
      const old = eventCheck.rows[0];
      const updated = result.rows[0];
      if (old.title !== updated.title)
        fieldsChanged.title = { before: old.title, after: updated.title };
      if (old.description !== updated.description)
        fieldsChanged.description = {
          before: old.description,
          after: updated.description,
        };
      if (old.event_type !== updated.event_type)
        fieldsChanged.event_type = {
          before: old.event_type,
          after: updated.event_type,
        };
      if (old.event_date !== updated.event_date)
        fieldsChanged.event_date = {
          before: old.event_date,
          after: updated.event_date,
        };
      if (old.event_time !== updated.event_time)
        fieldsChanged.event_time = {
          before: old.event_time,
          after: updated.event_time,
        };
      if (old.participants !== updated.participants)
        fieldsChanged.participants = {
          before: old.participants,
          after: updated.participants,
        };
      await logChanges(
        "events",
        id,
        ChangeTypes.update,
        req.user,
        fieldsChanged
      );
      res.json(decorateEvent(result.rows[0]));
    } catch (error) {
      console.error("Error updating event:", error);
      res.status(500).json({ error: "Failed to update event" });
    }
  });

  router.delete("/:id", authenticateToken, async (req, res) => {
    try {
      const { id } = req.params;

      const eventCheck = await pool.query(
        "SELECT created_by FROM events WHERE id = $1",
        [id]
      );
      if (eventCheck.rows.length === 0) {
        return res.status(404).json({ error: "Event not found" });
      }
      if (eventCheck.rows[0].created_by !== req.user.id) {
        return res
          .status(403)
          .json({ error: "You can only delete events you created" });
      }

      const result = await pool.query(
        "DELETE FROM events WHERE id = $1 RETURNING *",
        [id]
      );

      if (result.rows.length === 0) {
        return res.status(404).json({ error: "Event not found" });
      }

      await logChanges("events", id, ChangeTypes.delete, req.user);
      res.json({ message: "Event deleted successfully" });
    } catch (error) {
      console.error("Error deleting event:", error);
      res.status(500).json({ error: "Failed to delete event" });
    }
  });

  router.get("/:id", authenticateToken, async (req, res) => {
    try {
      const { id } = req.params;

      const result = await pool.query(
        `
        SELECT e.*, u.username as created_by_name 
        FROM events e 
        LEFT JOIN users u ON e.created_by = u.id 
        WHERE e.id = $1
      `,
        [id]
      );

      if (result.rows.length === 0) {
        return res.status(404).json({ error: "Event not found" });
      }

      res.json(decorateEvent(result.rows[0]));
    } catch (error) {
      console.error("Error fetching event:", error);
      res.status(500).json({ error: "Failed to fetch event" });
    }
  });

  return router;
}

module.exports = createEventsRouter;
