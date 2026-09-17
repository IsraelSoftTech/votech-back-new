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
const { isSuperAdminUsername } = require("../src/config/superAdmin");
const {
  NOT_SYSTEM_SQL,
  isSystemUser,
  isSystemUsername,
} = require("../src/services/superAdminSlots.service");

const router = express.Router();

function quoteIdent(name) {
  return `"${String(name).replace(/"/g, '""')}"`;
}

/**
 * Clears RESTRICT / NO ACTION foreign keys that would block DELETE FROM users.
 * CASCADE / SET NULL refs are left for Postgres to handle on the user delete.
 */
async function detachBlockingUserRefs(client, userId) {
  const { rows } = await client.query(
    `SELECT
        rel.relname AS table_name,
        att.attname AS column_name,
        con.confdeltype AS delete_rule,
        att.attnotnull AS not_null
       FROM pg_constraint con
       JOIN pg_class rel ON rel.oid = con.conrelid
       JOIN pg_namespace n ON n.oid = rel.relnamespace
       JOIN LATERAL unnest(con.conkey) WITH ORDINALITY AS cols(attnum, ord) ON TRUE
       JOIN pg_attribute att
         ON att.attrelid = con.conrelid AND att.attnum = cols.attnum
      WHERE con.contype = 'f'
        AND con.confrelid = 'public.users'::regclass
        AND n.nspname = 'public'`
  );

  for (const row of rows) {
    // c = CASCADE, n = SET NULL, d = SET DEFAULT — Postgres handles these.
    if (row.delete_rule === "c" || row.delete_rule === "n" || row.delete_rule === "d") {
      continue;
    }
    if (row.table_name === "users") continue;

    const table = quoteIdent(row.table_name);
    const column = quoteIdent(row.column_name);
    if (!row.not_null) {
      await client.query(
        `UPDATE ${table} SET ${column} = NULL WHERE ${column} = $1`,
        [userId]
      );
    } else {
      await client.query(`DELETE FROM ${table} WHERE ${column} = $1`, [userId]);
    }
  }
}

// Get all users (temporarily removed admin requirement for testing)
router.get("/", authenticateToken, async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT id, name, username, role, contact, email, gender, suspended, created_at
         FROM users
        WHERE ${NOT_SYSTEM_SQL}
        ORDER BY name`
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
      `SELECT id, name, username, role, contact FROM users
        WHERE id != $1 AND suspended = false AND ${NOT_SYSTEM_SQL}
        ORDER BY name`,
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
      `SELECT id, name, username, role, contact FROM users
        WHERE id != $1 AND suspended = false AND ${NOT_SYSTEM_SQL}
        ORDER BY name`,
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

// Check user details (supports username+email or username+contact for backward compatibility)
router.post("/check-user-details", async (req, res) => {
  try {
    const { username, contact, email } = req.body;

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

    // If email is provided, verify it matches (case-insensitive, trimmed)
    if (email !== undefined && email !== null && email !== "") {
      const userEmail = (user.email || "").trim().toLowerCase();
      const inputEmail = String(email).trim().toLowerCase();
      if (!userEmail) {
        return res.status(400).json({ error: "No email on file for this account" });
      }
      if (userEmail !== inputEmail) {
        return res.status(400).json({ error: "Email does not match this account" });
      }
    }

    // If contact is provided (legacy), verify it matches
    if (contact && user.contact) {
      const normalizePhone = (phone) => (phone || "").replace(/\D/g, "");
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
      `SELECT COUNT(*) as count FROM users WHERE role = $1 AND ${NOT_SYSTEM_SQL}`,
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
      `SELECT id, name, username, role, contact, email, gender, suspended, created_at
         FROM users
        WHERE ${NOT_SYSTEM_SQL}
        ORDER BY created_at DESC`
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
    const { name, username, role, contact, email, gender, password } = req.body;

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

    if (isSystemUser(existingUser.rows[0])) {
      return res.status(403).json({ error: "This workspace account cannot be edited" });
    }

    // Check Admin4 limit (maximum 2 Admin4 accounts)
    if (role === "Admin4") {
      const existingUserRole = existingUser.rows[0].role;

      // Only check limit if the user is not already Admin4
      if (existingUserRole !== "Admin4") {
        const admin4Count = await pool.query(
          `SELECT COUNT(*) FROM users WHERE role = $1 AND ${NOT_SYSTEM_SQL}`,
          ["Admin4"]
        );

        if (parseInt(admin4Count.rows[0].count) >= 2) {
          return res
            .status(400)
            .json({ error: "Maximum of 2 Admin4 accounts allowed" });
        }
      }
    }

    if (isSuperAdminUsername(username) || isSystemUsername(username)) {
      return res.status(400).json({ error: "This username is reserved" });
    }

    const usernameConflict = await pool.query(
      "SELECT * FROM users WHERE username = $1 AND id != $2",
      [username, id]
    );

    if (usernameConflict.rows.length > 0) {
      return res.status(400).json({ error: "Username already exists" });
    }

    const beforeState = existingUser.rows[0];

    const wantsPasswordChange =
      password && typeof password === "string" && password.trim().length > 0;
    if (wantsPasswordChange && req.user.role !== "Admin2") {
      return res.status(403).json({
        error: "Only Admin2 can change user passwords",
      });
    }

    // Only update password when a new one is provided (non-empty)
    let result;
    if (wantsPasswordChange) {
      const hashedPassword = await bcrypt.hash(password.trim(), 10);
      result = await pool.query(
        "UPDATE users SET name = $1, username = $2, role = $3, contact = $4, email = $5, gender = $6, password = $7 WHERE id = $8 RETURNING *",
        [name, username, role, contact || null, email || null, gender || null, hashedPassword, id]
      );
    } else {
      result = await pool.query(
        "UPDATE users SET name = $1, username = $2, role = $3, contact = $4, email = $5, gender = $6 WHERE id = $7 RETURNING *",
        [name, username, role, contact || null, email || null, gender || null, id]
      );
    }

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
        gender: beforeState.gender,
      },
      after: {
        name: afterState.name,
        username: afterState.username,
        role: afterState.role,
        contact: afterState.contact,
        email: afterState.email,
        gender: afterState.gender,
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
        gender: updatedUser.gender,
      },
    });
  } catch (error) {
    console.error("Error updating user:", error);
    res.status(500).json({ error: "Failed to update user" });
  }
});

// Delete user
router.delete("/:id", authenticateToken, requireAdmin, async (req, res) => {
  if (req.user.role !== "Admin3") {
    return res.status(403).json({ error: "Only Admin3 can delete users" });
  }
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { id } = req.params;

    const existingUser = await client.query("SELECT * FROM users WHERE id = $1", [
      id,
    ]);

    if (existingUser.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: "User not found" });
    }

    const username = existingUser.rows[0].username;
    const deletedData = existingUser.rows[0];

    if (isSystemUser(deletedData)) {
      await client.query("ROLLBACK");
      return res.status(403).json({ error: "This workspace account cannot be deleted" });
    }

    if (parseInt(id) === req.user.id) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: "Cannot delete your own account" });
    }

    // Blocking FKs (RESTRICT / NO ACTION) are the reason deletes used to hang
    // then fail: ~20 sequential savepoint deletes ran first, then Postgres
    // rejected the user row. Detach those refs, then one DELETE lets CASCADE
    // finish the rest.
    await detachBlockingUserRefs(client, id);
    await client.query("DELETE FROM users WHERE id = $1", [id]);

    await client.query("COMMIT");

    res.json({ message: "User deleted successfully" });

    const ipAddress = getIpAddress(req);
    const userAgent = getUserAgent(req);
    logUserActivity(
      req.user.id,
      "delete",
      `Deleted user: ${username}`,
      "user",
      id,
      username,
      ipAddress,
      userAgent
    ).catch(() => {});
    logChanges("users", id, ChangeTypes.delete, req.user, {
      deletedData,
    }).catch(() => {});
    return;
  } catch (error) {
    await client.query("ROLLBACK");
    console.error("Error deleting user:", error);
    
    // Check for foreign key constraint violation
    if (error.code === "23503") {
      res.status(400).json({ error: "Cannot delete user: User has related records. Please contact administrator." });
    } else {
      res.status(500).json({ error: "Failed to delete user" });
    }
  } finally {
    client.release();
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
      if (!["Admin2", "Admin3"].includes(req.user.role)) {
        return res
          .status(403)
          .json({ error: "Only Admin2 and Admin3 can suspend users" });
      }

      let { action } = req.body || {};

      const existingUser = await pool.query(
        "SELECT * FROM users WHERE id = $1",
        [id]
      );

      if (existingUser.rows.length === 0) {
        return res.status(404).json({ error: "User not found" });
      }

      const beforeState = existingUser.rows[0];

      if (isSystemUser(beforeState)) {
        return res
          .status(403)
          .json({ error: "This workspace account cannot be suspended" });
      }

      if (!action || !["suspend", "unsuspend"].includes(action)) {
        action = beforeState.suspended ? "unsuspend" : "suspend";
      }

      const username = beforeState.username;

      if (parseInt(id) === req.user.id) {
        return res
          .status(400)
          .json({ error: "Cannot suspend your own account" });
      }

      const suspended = action === "suspend";

      await pool.query("UPDATE users SET suspended = $1 WHERE id = $2", [
        suspended,
        id,
      ]);

      res.json({
        message: `User ${action}ed successfully`,
        suspended,
      });

      const ipAddress = getIpAddress(req);
      const userAgent = getUserAgent(req);
      logUserActivity(
        req.user.id,
        action,
        `${action} user: ${username}`,
        "user",
        id,
        username,
        ipAddress,
        userAgent
      ).catch(() => {});

      logChanges("users", id, ChangeTypes.update, req.user, {
        before: { suspended: beforeState.suspended },
        after: { suspended },
      }).catch(() => {});
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
        WHERE ${NOT_SYSTEM_SQL.replace(/is_system/g, "u.is_system")}
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
        WHERE ${NOT_SYSTEM_SQL}
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
