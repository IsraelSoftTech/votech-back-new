const express = require("express");
const multer = require("multer");
const ftpService = require("../ftp-service");
const {
  pool,
  authenticateToken,
  logUserActivity,
  getIpAddress,
  getUserAgent,
} = require("./utils");

const router = express.Router();

const { ChangeTypes, logChanges } = require("../src/utils/logChanges.util");

// Configure multer for file uploads
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB limit (client compresses before upload)
  },
});

// Send message
router.post("/", authenticateToken, async (req, res) => {
  try {
    const { receiver_id, content, group_id } = req.body;
    const sender_id = req.user.id;

    if (!content || content.trim() === "") {
      return res.status(400).json({ error: "Message content is required" });
    }

    if (!receiver_id && !group_id) {
      return res
        .status(400)
        .json({ error: "Either receiver_id or group_id is required" });
    }

    // Check if receiver exists (for direct messages)
    if (receiver_id) {
      const receiverExists = await pool.query(
        "SELECT id FROM users WHERE id = $1 AND suspended = false",
        [receiver_id]
      );

      if (receiverExists.rows.length === 0) {
        return res
          .status(404)
          .json({ error: "Receiver not found or suspended" });
      }
    }

    // Check if user is member of group (for group messages)
    if (group_id) {
      const groupMember = await pool.query(
        "SELECT * FROM group_participants WHERE group_id = $1 AND user_id = $2",
        [group_id, sender_id]
      );

      if (groupMember.rows.length === 0) {
        return res
          .status(403)
          .json({ error: "You are not a member of this group" });
      }
    }

    const result = await pool.query(
      "INSERT INTO messages (sender_id, receiver_id, group_id, content) VALUES ($1, $2, $3, $4) RETURNING *",
      [sender_id, receiver_id || null, group_id || null, content]
    );

    const message = result.rows[0];

    // Log activity
    const ipAddress = getIpAddress(req);
    const userAgent = getUserAgent(req);
    await logUserActivity(
      sender_id,
      "create",
      `Sent message to ${receiver_id ? "user" : "group"}`,
      "message",
      message.id,
      content.substring(0, 50),
      ipAddress,
      userAgent
    );

    await logChanges("messages", message.id, ChangeTypes.create, req.user);
    res.status(201).json({
      message: "Message sent successfully",
      data: message,
    });
  } catch (error) {
    console.error("Error sending message:", error);
    res.status(500).json({ error: "Failed to send message" });
  }
});

// Send message with file attachment
router.post(
  "/with-file",
  authenticateToken,
  upload.single("file"),
  async (req, res) => {
    try {
      const { receiver_id, content, group_id } = req.body;
      const sender_id = req.user.id;

      if (!req.file) {
        return res.status(400).json({ error: "File is required" });
      }

      if (!receiver_id && !group_id) {
        return res
          .status(400)
          .json({ error: "Either receiver_id or group_id is required" });
      }

      // Check if receiver exists (for direct messages)
      if (receiver_id) {
        const receiverExists = await pool.query(
          "SELECT id FROM users WHERE id = $1 AND suspended = false",
          [receiver_id]
        );

        if (receiverExists.rows.length === 0) {
          return res
            .status(404)
            .json({ error: "Receiver not found or suspended" });
        }
      }

      // Check if user is member of group (for group messages)
      if (group_id) {
        const groupMember = await pool.query(
          "SELECT * FROM group_participants WHERE group_id = $1 AND user_id = $2",
          [group_id, sender_id]
        );

        if (groupMember.rows.length === 0) {
          return res
            .status(403)
            .json({ error: "You are not a member of this group" });
        }
      }

      // Upload file to FTP
      const originalName = req.file.originalname || "file";
      const sanitizedOriginal = originalName.replace(/[^\w\-. ]/g, "_");
      const extension = sanitizedOriginal.includes(".")
        ? sanitizedOriginal.split(".").pop()
        : "";
      const baseName = sanitizedOriginal.replace(/\.[^.]+$/, "");
      const limitedBase =
        baseName.length > 40 ? baseName.slice(0, 40) : baseName;
      const fileName = `msg-${Date.now()}-${limitedBase}${
        extension ? "." + extension : ""
      }`;

      let fileUrl;
      try {
        fileUrl = await ftpService.uploadBuffer(req.file.buffer, fileName);
      } catch (ftpError) {
        console.error("Error uploading message file to FTP:", ftpError);
        return res.status(500).json({ error: "Failed to upload file" });
      }

      const safeFileName =
        originalName.length > 50 ? originalName.slice(0, 50) : originalName;
      const fileType = req.file.mimetype;

      const result = await pool.query(
        `INSERT INTO messages (
        sender_id, receiver_id, group_id, content, 
        file_url, file_name, file_type
      ) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
        [
          sender_id,
          receiver_id || null,
          group_id || null,
          content || "",
          fileUrl,
          safeFileName,
          fileType,
        ]
      );

      const message = result.rows[0];

      // Log activity
      const ipAddress = getIpAddress(req);
      const userAgent = getUserAgent(req);
      await logUserActivity(
        sender_id,
        "create",
        `Sent file message to ${receiver_id ? "user" : "group"}`,
        "message",
        message.id,
        safeFileName,
        ipAddress,
        userAgent
      );

      await logChanges("messages", message.id, ChangeTypes.create, req.user);
      res.status(201).json({
        message: "File message sent successfully",
        data: message,
      });
    } catch (error) {
      console.error("Error sending file message:", error);
      res.status(500).json({ error: "Failed to send file message" });
    }
  }
);

// Get unread message count grouped by sender (direct chats)
router.get("/unread/count", authenticateToken, async (req, res) => {
  try {
    const currentUserId = req.user.id;

    const result = await pool.query(
      `SELECT 
        sender_id,
        COUNT(*) as unread_count
       FROM messages 
       WHERE receiver_id = $1 
         AND read_at IS NULL
         AND group_id IS NULL
       GROUP BY sender_id`,
      [currentUserId]
    );

    res.json(result.rows);
  } catch (error) {
    console.error("Error fetching unread count:", error);
    res.status(500).json({ error: "Failed to fetch unread count" });
  }
});

// Total unread across direct + group chats for the logged-in user
router.get("/unread/total", authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;

    const [directResult, groupResult] = await Promise.all([
      pool.query(
        `SELECT COUNT(*)::int AS total
         FROM messages
         WHERE receiver_id = $1
           AND read_at IS NULL
           AND group_id IS NULL`,
        [userId]
      ),
      pool.query(
        `SELECT COUNT(*)::int AS total
         FROM messages m
         INNER JOIN group_participants gp
           ON gp.group_id = m.group_id AND gp.user_id = $1
         WHERE m.group_id IS NOT NULL
           AND m.sender_id != $1
           AND m.read_at IS NULL`,
        [userId]
      ),
    ]);

    const direct = directResult.rows[0]?.total ?? 0;
    const group = groupResult.rows[0]?.total ?? 0;

    res.json({ total: direct + group, direct, group });
  } catch (error) {
    console.error("Error fetching total unread count:", error);
    res.status(500).json({ error: "Failed to fetch total unread count" });
  }
});

// Get messages between two users
router.get("/:userId", authenticateToken, async (req, res) => {
  try {
    const { userId } = req.params;
    const currentUserId = req.user.id;
    const { limit = 50, offset = 0 } = req.query;

    // Check if the other user exists
    const otherUserExists = await pool.query(
      "SELECT id FROM users WHERE id = $1 AND suspended = false",
      [userId]
    );

    if (otherUserExists.rows.length === 0) {
      return res.status(404).json({ error: "User not found or suspended" });
    }

    const result = await pool.query(
      `SELECT 
        m.*,
        u.name as sender_name,
        u.username as sender_username
       FROM messages m
       JOIN users u ON m.sender_id = u.id
       WHERE (m.sender_id = $1 AND m.receiver_id = $2)
          OR (m.sender_id = $2 AND m.receiver_id = $1)
       ORDER BY m.created_at DESC
       LIMIT $3 OFFSET $4`,
      [currentUserId, userId, parseInt(limit), parseInt(offset)]
    );

    res.json(result.rows.reverse()); // Reverse to get chronological order
  } catch (error) {
    console.error("Error fetching messages:", error);
    res.status(500).json({ error: "Failed to fetch messages" });
  }
});

// Mark messages as read
router.post("/:userId/read", authenticateToken, async (req, res) => {
  try {
    const { userId } = req.params;
    const currentUserId = req.user.id;

    // Get old records before update
    const oldRecords = await pool.query(
      `SELECT * FROM messages 
       WHERE sender_id = $1 
         AND receiver_id = $2 
         AND read_at IS NULL`,
      [userId, currentUserId]
    );

    // Mark all unread messages from this user as read
    const result = await pool.query(
      `UPDATE messages 
       SET read_at = CURRENT_TIMESTAMP 
       WHERE sender_id = $1 
         AND receiver_id = $2 
         AND read_at IS NULL
       RETURNING *`,
      [userId, currentUserId]
    );

    // Log changes for each updated message
    for (let i = 0; i < result.rows.length; i++) {
      const old = oldRecords.rows[i];
      const updated = result.rows[i];
      const fieldsChanged = {};
      if (old.read_at !== updated.read_at)
        fieldsChanged.read_at = { before: old.read_at, after: updated.read_at };
      await logChanges(
        "messages",
        updated.id,
        ChangeTypes.update,
        req.user,
        fieldsChanged
      );
    }

    res.json({
      message: "Messages marked as read",
      updatedCount: result.rowCount,
    });
  } catch (error) {
    console.error("Error marking messages as read:", error);
    res.status(500).json({ error: "Failed to mark messages as read" });
  }
});

// Delete message
router.delete("/:messageId", authenticateToken, async (req, res) => {
  try {
    const { messageId } = req.params;
    const currentUserId = req.user.id;

    // Check if message exists and belongs to current user
    const messageExists = await pool.query(
      "SELECT * FROM messages WHERE id = $1 AND sender_id = $2",
      [messageId, currentUserId]
    );

    if (messageExists.rows.length === 0) {
      return res
        .status(404)
        .json({
          error: "Message not found or you do not have permission to delete it",
        });
    }

    await pool.query("DELETE FROM messages WHERE id = $1", [messageId]);

    // Log activity
    const ipAddress = getIpAddress(req);
    const userAgent = getUserAgent(req);
    await logUserActivity(
      currentUserId,
      "delete",
      "Deleted message",
      "message",
      messageId,
      "Message deleted",
      ipAddress,
      userAgent
    );

    await logChanges("messages", messageId, ChangeTypes.delete, req.user);
    res.json({ message: "Message deleted successfully" });
  } catch (error) {
    console.error("Error deleting message:", error);
    res.status(500).json({ error: "Failed to delete message" });
  }
});

// Get group messages
router.get("/group/:groupId", authenticateToken, async (req, res) => {
  try {
    const { groupId } = req.params;
    const currentUserId = req.user.id;
    const { limit = 50, offset = 0 } = req.query;

    // Check if user is member of group
    const groupMember = await pool.query(
      "SELECT * FROM group_participants WHERE group_id = $1 AND user_id = $2",
      [groupId, currentUserId]
    );

    if (groupMember.rows.length === 0) {
      return res
        .status(403)
        .json({ error: "You are not a member of this group" });
    }

    const result = await pool.query(
      `SELECT 
        m.*,
        u.name as sender_name,
        u.username as sender_username
       FROM messages m
       JOIN users u ON m.sender_id = u.id
       WHERE m.group_id = $1
       ORDER BY m.created_at DESC
       LIMIT $2 OFFSET $3`,
      [groupId, parseInt(limit), parseInt(offset)]
    );

    res.json(result.rows.reverse()); // Reverse to get chronological order
  } catch (error) {
    console.error("Error fetching group messages:", error);
    res.status(500).json({ error: "Failed to fetch group messages" });
  }
});

module.exports = router;
