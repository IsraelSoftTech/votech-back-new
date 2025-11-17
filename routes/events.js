const express = require("express");
const router = express.Router();

const { ChangeTypes, logChanges } = require("../src/utils/logChanges.util");

function createEventsRouter(pool, authenticateToken) {
  // Get all events
  router.get("/", authenticateToken, async (req, res) => {
    try {
      const result = await pool.query(`
        SELECT e.*, u.username as created_by_name 
        FROM events e 
        LEFT JOIN users u ON e.created_by = u.id 
        ORDER BY e.event_date DESC, e.event_time DESC
      `);
      res.json(result.rows);
    } catch (error) {
      console.error("Error fetching events:", error);
      res.status(500).json({ error: "Failed to fetch events" });
    }
  });

  // Get events by date range
  router.get("/range", authenticateToken, async (req, res) => {
    try {
      const { start_date, end_date } = req.query;

      if (!start_date || !end_date) {
        return res
          .status(400)
          .json({ error: "Start date and end date are required" });
      }

      const result = await pool.query(
        `
        SELECT e.*, u.username as created_by_name 
        FROM events e 
        LEFT JOIN users u ON e.created_by = u.id 
        WHERE e.event_date >= $1 AND e.event_date <= $2
        ORDER BY e.event_date ASC, e.event_time ASC
      `,
        [start_date, end_date]
      );

      res.json(result.rows);
    } catch (error) {
      console.error("Error fetching events by range:", error);
      res.status(500).json({ error: "Failed to fetch events" });
    }
  });

  // Get events for a specific user (participant)
  router.get("/my-events", authenticateToken, async (req, res) => {
    try {
      const userId = req.user.id;

      // Get events where the user is a participant
      const result = await pool.query(
        `
        SELECT e.*, u.username as created_by_name 
        FROM events e 
        LEFT JOIN users u ON e.created_by = u.id 
        WHERE e.participants LIKE $1 OR e.participants LIKE $2 OR e.participants LIKE $3
        ORDER BY e.event_date ASC, e.event_time ASC
      `,
        [
          `%${req.user.username}%`,
          `${req.user.username},%`,
          `%,${req.user.username}%`,
        ]
      );

      res.json(result.rows);
    } catch (error) {
      console.error("Error fetching user events:", error);
      res.status(500).json({ error: "Failed to fetch user events" });
    }
  });

  // Get upcoming events
  router.get("/upcoming", authenticateToken, async (req, res) => {
    try {
      const result = await pool.query(`
        SELECT e.*, u.username as created_by_name 
        FROM events e 
        LEFT JOIN users u ON e.created_by = u.id 
        WHERE e.event_date >= CURRENT_DATE
        ORDER BY e.event_date ASC, e.event_time ASC
        LIMIT 10
      `);
      res.json(result.rows);
    } catch (error) {
      console.error("Error fetching upcoming events:", error);
      res.status(500).json({ error: "Failed to fetch upcoming events" });
    }
  });

  // Get event statistics
  router.get("/stats", authenticateToken, async (req, res) => {
    try {
      const totalResult = await pool.query(
        "SELECT COUNT(*) as total FROM events"
      );
      const upcomingResult = await pool.query(`
        SELECT COUNT(*) as upcoming 
        FROM events 
        WHERE event_date >= CURRENT_DATE
      `);

      res.json({
        total: parseInt(totalResult.rows[0].total),
        upcoming: parseInt(upcomingResult.rows[0].upcoming),
      });
    } catch (error) {
      console.error("Error fetching event stats:", error);
      res.status(500).json({ error: "Failed to fetch event statistics" });
    }
  });

  // Create a new event
  router.post("/", authenticateToken, async (req, res) => {
    try {
      // Allow only Admin1-Admin4 and Discipline to create events
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

      const {
        title,
        description,
        event_type,
        event_date,
        event_time,
        participants,
      } = req.body;
      const created_by = req.user.id;

      // Validate required fields
      if (!title || !event_type || !event_date || !event_time) {
        return res
          .status(400)
          .json({ error: "Title, event type, date, and time are required" });
      }

      // Validate event type
      const validTypes = ["Meeting", "Class", "Others"];
      if (!validTypes.includes(event_type)) {
        return res
          .status(400)
          .json({
            error: "Invalid event type. Must be Meeting, Class, or Others",
          });
      }

      // Check if an event already exists on this date
      const existingEvent = await pool.query(
        `
        SELECT id, title FROM events WHERE event_date = $1
      `,
        [event_date]
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
        INSERT INTO events (title, description, event_type, event_date, event_time, participants, created_by)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
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
        ]
      );

      await logChanges(
        "events",
        result.rows[0].id,
        ChangeTypes.create,
        req.user
      );
      res.status(201).json(result.rows[0]);
    } catch (error) {
      console.error("Error creating event:", error);
      res.status(500).json({ error: "Failed to create event" });
    }
  });

  // Update an event
  router.put("/:id", authenticateToken, async (req, res) => {
    try {
      const { id } = req.params;
      const {
        title,
        description,
        event_type,
        event_date,
        event_time,
        participants,
      } = req.body;

      // Check if user is the creator of this event
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

      // Validate required fields
      if (!title || !event_type || !event_date || !event_time) {
        return res
          .status(400)
          .json({ error: "Title, event type, date, and time are required" });
      }

      // Validate event type
      const validTypes = ["Meeting", "Class", "Others"];
      if (!validTypes.includes(event_type)) {
        return res
          .status(400)
          .json({
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
      res.json(result.rows[0]);
    } catch (error) {
      console.error("Error updating event:", error);
      res.status(500).json({ error: "Failed to update event" });
    }
  });

  // Delete an event
  router.delete("/:id", authenticateToken, async (req, res) => {
    try {
      const { id } = req.params;

      // Check if user is the creator of this event
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

  // Get a single event by ID
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

      res.json(result.rows[0]);
    } catch (error) {
      console.error("Error fetching event:", error);
      res.status(500).json({ error: "Failed to fetch event" });
    }
  });

  return router;
}

module.exports = createEventsRouter;
