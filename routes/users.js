const express = require("express");
const bcrypt = require("bcryptjs");
const {
  pool,
  authenticateToken,
  logUserActivity,
  getIpAddress,
  getUserAgent,
  requireAdmin,
} = require("./utils");

const { logChanges, ChangeTypes } = require("../src/utils/logChanges.util");

const router = express.Router();

// Get all users (temporarily removed admin requirement for testing)
router.get("/", authenticateToken, async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT id, name, username, role, contact, email, suspended, created_at FROM users ORDER BY name"
    );
    res.json(result.rows);
  } catch (error) {
    console.error("Error fetching users:", error);
    res.status(500).json({ error: "Failed to fetch users" });
  }
});

// Get all users for chat
router.get("/all-chat", authenticateToken, async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT id, name, username, role, contact FROM users WHERE id != $1 AND suspended = false ORDER BY name",
      [req.user.id]
    );
    res.json(result.rows);
  } catch (error) {
    console.error("Error fetching users for chat:", error);
    res.status(500).json({ error: "Failed to fetch users for chat" });
  }
});

// Get chat list with last messages
router.get("/chat-list", authenticateToken, async (req, res) => {
  try {
    // First get all users except current user
    const usersResult = await pool.query(
      "SELECT id, name, username, role, contact FROM users WHERE id != $1 AND suspended = false ORDER BY name",
      [req.user.id]
    );

    // Then get the last message for each conversation
    const lastMessagesResult = await pool.query(
      `SELECT
        CASE
          WHEN sender_id = $1 THEN receiver_id
          ELSE sender_id
        END as other_user_id,
        content as last_message,
        created_at as last_message_time,
        sender_id = $1 as is_sent_by_me
      FROM messages m1
      WHERE created_at = (
        SELECT MAX(created_at)
        FROM messages m2
        WHERE (m2.sender_id = $1 AND m2.receiver_id = m1.receiver_id)
           OR (m2.receiver_id = $1 AND m2.sender_id = m1.sender_id)
      )
      ORDER BY last_message_time DESC`,
      [req.user.id]
    );

    // Combine users with their last messages
    const users = usersResult.rows;
    const lastMessages = lastMessagesResult.rows;

    const chatList = users.map((user) => {
      const lastMessage = lastMessages.find(
        (msg) => msg.other_user_id === user.id
      );
      return {
        ...user,
        last_message: lastMessage ? lastMessage.last_message : null,
        last_message_time: lastMessage ? lastMessage.last_message_time : null,
        is_sent_by_me: lastMessage ? lastMessage.is_sent_by_me : null,
      };
    });

    res.json(chatList);
  } catch (error) {
    console.error("Error fetching chat list:", error);
    res.status(500).json({ error: "Failed to fetch chat list" });
  }
});

// Check user details
router.post("/check-user-details", async (req, res) => {
  try {
    const { username, contact } = req.body;

    if (!username) {
      return res.status(400).json({ error: "Username is required" });
    }

    const result = await pool.query(
      "SELECT id, name, username, role, contact, email FROM users WHERE username = $1",
      [username]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "User not found" });
    }

    const user = result.rows[0];

    // If contact is provided, verify it matches (normalize phone numbers for comparison)
    if (contact && user.contact) {
      const normalizePhone = (phone) => {
        return phone.replace(/\D/g, ""); // Remove all non-digits
      };

      const normalizedUserContact = normalizePhone(user.contact);
      const normalizedInputContact = normalizePhone(contact);

      if (normalizedUserContact !== normalizedInputContact) {
        return res.status(400).json({ error: "Phone number does not match" });
      }
    }

    res.json({
      exists: true,
      user: {
        id: user.id,
        name: user.name,
        username: user.username,
        role: user.role,
        contact: user.contact,
        email: user.email,
      },
    });
  } catch (error) {
    console.error("Error checking user details:", error);
    res.status(500).json({ error: "Failed to check user details" });
  }
});

// Get Admin3 count (no authentication required)
router.get("/admin3-count", async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT COUNT(*) as count FROM users WHERE role = $1",
      ["Admin3"]
    );

    const count = parseInt(result.rows[0].count);
    res.json({ count });
  } catch (error) {
    console.error("Error getting Admin3 count:", error);
    res.status(500).json({ error: "Failed to get Admin3 count" });
  }
});

// Get all users (admin only)
router.get("/all", authenticateToken, requireAdmin, async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT id, name, username, role, contact, email, suspended, created_at FROM users ORDER BY created_at DESC"
    );
    res.json(result.rows);
  } catch (error) {
    console.error("Error fetching all users:", error);
    res.status(500).json({ error: "Failed to fetch all users" });
  }
});

// Update user
router.put("/:id", authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { name, username, role, contact, email } = req.body;

    if (!name || !username || !role) {
      return res
        .status(400)
        .json({ error: "Name, username, and role are required" });
    }

    const existingUser = await pool.query("SELECT * FROM users WHERE id = $1", [
      id,
    ]);

    if (existingUser.rows.length === 0) {
      return res.status(404).json({ error: "User not found" });
    }

    // Check Admin4 limit (maximum 2 Admin4 accounts)
    if (role === "Admin4") {
      const existingUserRole = existingUser.rows[0].role;

      // Only check limit if the user is not already Admin4
      if (existingUserRole !== "Admin4") {
        const admin4Count = await pool.query(
          "SELECT COUNT(*) FROM users WHERE role = $1",
          ["Admin4"]
        );

        if (parseInt(admin4Count.rows[0].count) >= 2) {
          return res
            .status(400)
            .json({ error: "Maximum of 2 Admin4 accounts allowed" });
        }
      }
    }

    const usernameConflict = await pool.query(
      "SELECT * FROM users WHERE username = $1 AND id != $2",
      [username, id]
    );

    if (usernameConflict.rows.length > 0) {
      return res.status(400).json({ error: "Username already exists" });
    }

    const beforeState = existingUser.rows[0];

    const result = await pool.query(
      "UPDATE users SET name = $1, username = $2, role = $3, contact = $4, email = $5 WHERE id = $6 RETURNING *",
      [name, username, role, contact || null, email || null, id]
    );

    const updatedUser = result.rows[0];

    const ipAddress = getIpAddress(req);
    const userAgent = getUserAgent(req);
    await logUserActivity(
      req.user.id,
      "update",
      `Updated user: ${username}`,
      "user",
      id,
      username,
      ipAddress,
      userAgent
    );

    const afterState = updatedUser;
    const fieldsChanged = {
      before: {
        name: beforeState.name,
        username: beforeState.username,
        role: beforeState.role,
        contact: beforeState.contact,
        email: beforeState.email,
      },
      after: {
        name: afterState.name,
        username: afterState.username,
        role: afterState.role,
        contact: afterState.contact,
        email: afterState.email,
      },
    };

    await logChanges("users", id, ChangeTypes.update, req.user, fieldsChanged);

    res.json({
      message: "User updated successfully",
      user: {
        id: updatedUser.id,
        name: updatedUser.name,
        username: updatedUser.username,
        role: updatedUser.role,
        contact: updatedUser.contact,
        email: updatedUser.email,
      },
    });
  } catch (error) {
    console.error("Error updating user:", error);
    res.status(500).json({ error: "Failed to update user" });
  }
});

// Delete user
router.delete("/:id", authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;

    const existingUser = await pool.query("SELECT * FROM users WHERE id = $1", [
      id,
    ]);

    if (existingUser.rows.length === 0) {
      return res.status(404).json({ error: "User not found" });
    }

    const username = existingUser.rows[0].username;
    const deletedData = existingUser.rows[0];

    if (parseInt(id) === req.user.id) {
      return res.status(400).json({ error: "Cannot delete your own account" });
    }

    await pool.query("DELETE FROM users WHERE id = $1", [id]);

    const ipAddress = getIpAddress(req);
    const userAgent = getUserAgent(req);
    await logUserActivity(
      req.user.id,
      "delete",
      `Deleted user: ${username}`,
      "user",
      id,
      username,
      ipAddress,
      userAgent
    );

    await logChanges("users", id, ChangeTypes.delete, req.user, {
      deletedData,
    });

    res.json({ message: "User deleted successfully" });
  } catch (error) {
    console.error("Error deleting user:", error);
    res.status(500).json({ error: "Failed to delete user" });
  }
});

// Suspend/Unsuspend user
router.post(
  "/:id/suspend",
  authenticateToken,
  requireAdmin,
  async (req, res) => {
    try {
      const { id } = req.params;
      const { action } = req.body;

      if (!action || !["suspend", "unsuspend"].includes(action)) {
        return res
          .status(400)
          .json({ error: "Valid action is required (suspend or unsuspend)" });
      }

      const existingUser = await pool.query(
        "SELECT * FROM users WHERE id = $1",
        [id]
      );

      if (existingUser.rows.length === 0) {
        return res.status(404).json({ error: "User not found" });
      }

      const username = existingUser.rows[0].username;

      if (parseInt(id) === req.user.id) {
        return res
          .status(400)
          .json({ error: "Cannot suspend your own account" });
      }

      const beforeState = existingUser.rows[0];
      const suspended = action === "suspend";

      await pool.query("UPDATE users SET suspended = $1 WHERE id = $2", [
        suspended,
        id,
      ]);

      const ipAddress = getIpAddress(req);
      const userAgent = getUserAgent(req);
      await logUserActivity(
        req.user.id,
        action,
        `${action} user: ${username}`,
        "user",
        id,
        username,
        ipAddress,
        userAgent
      );

      const fieldsChanged = {
        before: { suspended: beforeState.suspended },
        after: { suspended: suspended },
      };

      await logChanges(
        "users",
        id,
        ChangeTypes.update,
        req.user,
        fieldsChanged
      );

      res.json({ message: `User ${action}ed successfully` });
    } catch (error) {
      console.error("Error suspending user:", error);
      res.status(500).json({ error: "Failed to suspend user" });
    }
  }
);

// Get user monitoring data
router.get(
  "/monitor/users",
  authenticateToken,
  requireAdmin,
  async (req, res) => {
    try {
      try {
        const result = await pool.query(`
        SELECT 
          u.id,
          u.name,
          u.username,
          u.role,
          u.suspended,
          u.created_at,
          COUNT(ua.id) as activity_count,
          MAX(ua.created_at) as last_activity
        FROM users u
        LEFT JOIN user_activities ua ON u.id = ua.user_id
        GROUP BY u.id, u.name, u.username, u.role, u.suspended, u.created_at
        ORDER BY u.created_at DESC
      `);
        res.json(result.rows);
      } catch (joinError) {
        console.log("user_activities table not found, using basic query");
        const result = await pool.query(`
        SELECT 
          id,
          name,
          username,
          role,
          suspended,
          created_at,
          0 as activity_count,
          NULL as last_activity
        FROM users
        ORDER BY created_at DESC
      `);
        res.json(result.rows);
      }
    } catch (error) {
      console.error("Error fetching user monitoring data:", error);
      res.status(500).json({ error: "Failed to fetch user monitoring data" });
    }
  }
);

// Get user activities
router.get(
  "/monitor/user-activities",
  authenticateToken,
  requireAdmin,
  async (req, res) => {
    try {
      const { userId, limit = 50 } = req.query;

      try {
        let query = `
        SELECT 
          ua.*,
          u.name as user_name,
          u.username
        FROM user_activities ua
        JOIN users u ON ua.user_id = u.id
      `;

        const params = [];
        if (userId) {
          query += " WHERE ua.user_id = $1";
          params.push(userId);
        }

        query += " ORDER BY ua.created_at DESC LIMIT $" + (params.length + 1);
        params.push(parseInt(limit));

        const result = await pool.query(query, params);
        res.json(result.rows);
      } catch (tableError) {
        console.log("user_activities table not found, returning empty array");
        res.json([]);
      }
    } catch (error) {
      console.error("Error fetching user activities:", error);
      res.status(500).json({ error: "Failed to fetch user activities" });
    }
  }
);

// Get user sessions
router.get(
  "/monitor/user-sessions",
  authenticateToken,
  requireAdmin,
  async (req, res) => {
    try {
      const { userId, limit = 50 } = req.query;

      try {
        let query = `
        SELECT 
          us.*,
          u.name as user_name,
          u.username
        FROM user_sessions us
        JOIN users u ON us.user_id = u.id
      `;

        const params = [];
        if (userId) {
          query += " WHERE us.user_id = $1";
          params.push(userId);
        }

        query += " ORDER BY us.created_at DESC LIMIT $" + (params.length + 1);
        params.push(parseInt(limit));

        const result = await pool.query(query, params);
        res.json(result.rows);
      } catch (tableError) {
        console.log("user_sessions table not found, returning empty array");
        res.json([]);
      }
    } catch (error) {
      console.error("Error fetching user sessions:", error);
      res.status(500).json({ error: "Failed to fetch user sessions" });
    }
  }
);

// Get user assigned data
router.get("/assigned-data/:userId", authenticateToken, async (req, res) => {
  try {
    const { userId } = req.params;

    // Get user's assigned classes, subjects, students, etc.
    const assignedData = {
      classes: [],
      subjects: [],
      students: [],
      applications: [],
    };

    // Get assigned classes
    const classesResult = await pool.query(
      `
      SELECT c.* FROM classes c 
      WHERE c.teacher_id = $1
    `,
      [userId]
    );
    assignedData.classes = classesResult.rows;

    // Get assigned subjects
    const subjectsResult = await pool.query(
      `
      SELECT s.* FROM subjects s 
      JOIN teacher_subjects ts ON s.id = ts.subject_id 
      WHERE ts.teacher_id = $1
    `,
      [userId]
    );
    assignedData.subjects = subjectsResult.rows;

    // Get assigned students (for class teachers)
    const studentsResult = await pool.query(
      `
      SELECT s.* FROM students s 
      JOIN classes c ON s.class_id = c.id 
      WHERE c.teacher_id = $1
    `,
      [userId]
    );
    assignedData.students = studentsResult.rows;

    // Applications feature removed
    assignedData.applications = [];

    res.json(assignedData);
  } catch (error) {
    console.error("Error fetching user assigned data:", error);
    res.status(500).json({ error: "Failed to fetch user assigned data" });
  }
});

module.exports = router;
