const express = require('express');
const bcrypt = require('bcryptjs');
const { pool, authenticateToken, logUserActivity, getIpAddress, getUserAgent, requireAdmin } = require('./utils');

const router = express.Router();

// Get all users
router.get('/', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT id, name, username, role, contact, email, suspended, created_at FROM users ORDER BY name'
    );
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching users:', error);
    res.status(500).json({ error: 'Failed to fetch users' });
  }
});

// Get all users for chat
router.get('/all-chat', authenticateToken, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT id, name, username, role, contact FROM users WHERE id != $1 AND suspended = false ORDER BY name',
      [req.user.id]
    );
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching users for chat:', error);
    res.status(500).json({ error: 'Failed to fetch users for chat' });
  }
});

// Get chat list with last messages
router.get('/chat-list', authenticateToken, async (req, res) => {
  try {
    // First get all users except current user
    const usersResult = await pool.query(
      'SELECT id, name, username, role, contact FROM users WHERE id != $1 AND suspended = false ORDER BY name',
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

    const chatList = users.map(user => {
      const lastMessage = lastMessages.find(msg => msg.other_user_id === user.id);
      return {
        ...user,
        last_message: lastMessage ? lastMessage.last_message : null,
        last_message_time: lastMessage ? lastMessage.last_message_time : null,
        is_sent_by_me: lastMessage ? lastMessage.is_sent_by_me : null
      };
    });

    res.json(chatList);
  } catch (error) {
    console.error('Error fetching chat list:', error);
    res.status(500).json({ error: 'Failed to fetch chat list' });
  }
});

// Check user details
router.post('/check-user-details', async (req, res) => {
  try {
    const { username } = req.body;

    if (!username) {
      return res.status(400).json({ error: 'Username is required' });
    }

    const result = await pool.query(
      'SELECT id, name, username, role, contact, email FROM users WHERE username = $1',
      [username]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    res.json({ user: result.rows[0] });
  } catch (error) {
    console.error('Error checking user details:', error);
    res.status(500).json({ error: 'Failed to check user details' });
  }
});

// Get all users (admin only)
router.get('/all', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT id, name, username, role, contact, email, suspended, created_at FROM users ORDER BY created_at DESC'
    );
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching all users:', error);
    res.status(500).json({ error: 'Failed to fetch all users' });
  }
});

// Update user
router.put('/:id', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { name, username, role, contact, email } = req.body;

    if (!name || !username || !role) {
      return res.status(400).json({ error: 'Name, username, and role are required' });
    }

    // Check if user exists
    const existingUser = await pool.query(
      'SELECT * FROM users WHERE id = $1',
      [id]
    );

    if (existingUser.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Check if username conflicts with other users
    const usernameConflict = await pool.query(
      'SELECT * FROM users WHERE username = $1 AND id != $2',
      [username, id]
    );

    if (usernameConflict.rows.length > 0) {
      return res.status(400).json({ error: 'Username already exists' });
    }

    const result = await pool.query(
      'UPDATE users SET name = $1, username = $2, role = $3, contact = $4, email = $5 WHERE id = $6 RETURNING *',
      [name, username, role, contact || null, email || null, id]
    );

    const updatedUser = result.rows[0];

    // Log activity
    const ipAddress = getIpAddress(req);
    const userAgent = getUserAgent(req);
    await logUserActivity(
      req.user.id,
      'update',
      `Updated user: ${username}`,
      'user',
      id,
      username,
      ipAddress,
      userAgent
    );

    res.json({
      message: 'User updated successfully',
      user: {
        id: updatedUser.id,
        name: updatedUser.name,
        username: updatedUser.username,
        role: updatedUser.role,
        contact: updatedUser.contact,
        email: updatedUser.email
      }
    });
  } catch (error) {
    console.error('Error updating user:', error);
    res.status(500).json({ error: 'Failed to update user' });
  }
});

// Delete user
router.delete('/:id', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;

    // Check if user exists
    const existingUser = await pool.query(
      'SELECT * FROM users WHERE id = $1',
      [id]
    );

    if (existingUser.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    const username = existingUser.rows[0].username;

    // Prevent deleting self
    if (parseInt(id) === req.user.id) {
      return res.status(400).json({ error: 'Cannot delete your own account' });
    }

    await pool.query('DELETE FROM users WHERE id = $1', [id]);

    // Log activity
    const ipAddress = getIpAddress(req);
    const userAgent = getUserAgent(req);
    await logUserActivity(
      req.user.id,
      'delete',
      `Deleted user: ${username}`,
      'user',
      id,
      username,
      ipAddress,
      userAgent
    );

    res.json({ message: 'User deleted successfully' });
  } catch (error) {
    console.error('Error deleting user:', error);
    res.status(500).json({ error: 'Failed to delete user' });
  }
});

// Suspend/Unsuspend user
router.post('/:id/suspend', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { action } = req.body; // 'suspend' or 'unsuspend'

    if (!action || !['suspend', 'unsuspend'].includes(action)) {
      return res.status(400).json({ error: 'Valid action is required (suspend or unsuspend)' });
    }

    // Check if user exists
    const existingUser = await pool.query(
      'SELECT * FROM users WHERE id = $1',
      [id]
    );

    if (existingUser.rows.length === 0) {
      return res.status(404).json({ error: 'User not found' });
    }

    const username = existingUser.rows[0].username;

    // Prevent suspending self
    if (parseInt(id) === req.user.id) {
      return res.status(400).json({ error: 'Cannot suspend your own account' });
    }

    const suspended = action === 'suspend';
    await pool.query(
      'UPDATE users SET suspended = $1 WHERE id = $2',
      [suspended, id]
    );

    // Log activity
    const ipAddress = getIpAddress(req);
    const userAgent = getUserAgent(req);
    await logUserActivity(
      req.user.id,
      action,
      `${action} user: ${username}`,
      'user',
      id,
      username,
      ipAddress,
      userAgent
    );

    res.json({ message: `User ${action}ed successfully` });
  } catch (error) {
    console.error('Error suspending user:', error);
    res.status(500).json({ error: 'Failed to suspend user' });
  }
});

// Get user monitoring data
router.get('/monitor/users', authenticateToken, requireAdmin, async (req, res) => {
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
  } catch (error) {
    console.error('Error fetching user monitoring data:', error);
    res.status(500).json({ error: 'Failed to fetch user monitoring data' });
  }
});

// Get user activities
router.get('/monitor/user-activities', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { userId, limit = 50 } = req.query;
    
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
      query += ' WHERE ua.user_id = $1';
      params.push(userId);
    }
    
    query += ' ORDER BY ua.created_at DESC LIMIT $' + (params.length + 1);
    params.push(parseInt(limit));

    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching user activities:', error);
    res.status(500).json({ error: 'Failed to fetch user activities' });
  }
});

// Get user sessions
router.get('/monitor/user-sessions', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { userId, limit = 50 } = req.query;
    
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
      query += ' WHERE us.user_id = $1';
      params.push(userId);
    }
    
    query += ' ORDER BY us.created_at DESC LIMIT $' + (params.length + 1);
    params.push(parseInt(limit));

    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching user sessions:', error);
    res.status(500).json({ error: 'Failed to fetch user sessions' });
  }
});

// Get user assigned data
router.get('/assigned-data/:userId', authenticateToken, async (req, res) => {
  try {
    const { userId } = req.params;
    
    // Get user's assigned classes, subjects, students, etc.
    const assignedData = {
      classes: [],
      subjects: [],
      students: [],
      applications: []
    };
    
    // Get assigned classes
    const classesResult = await pool.query(`
      SELECT c.* FROM classes c 
      WHERE c.teacher_id = $1
    `, [userId]);
    assignedData.classes = classesResult.rows;
    
    // Get assigned subjects
    const subjectsResult = await pool.query(`
      SELECT s.* FROM subjects s 
      JOIN teacher_subjects ts ON s.id = ts.subject_id 
      WHERE ts.teacher_id = $1
    `, [userId]);
    assignedData.subjects = subjectsResult.rows;
    
    // Get assigned students (for class teachers)
    const studentsResult = await pool.query(`
      SELECT s.* FROM students s 
      JOIN classes c ON s.class_id = c.id 
      WHERE c.teacher_id = $1
    `, [userId]);
    assignedData.students = studentsResult.rows;
    
    // Get assigned applications
    const applicationsResult = await pool.query(`
      SELECT a.* FROM applications a 
      WHERE a.assigned_to = $1
    `, [userId]);
    assignedData.applications = applicationsResult.rows;
    
    res.json(assignedData);
  } catch (error) {
    console.error('Error fetching user assigned data:', error);
    res.status(500).json({ error: 'Failed to fetch user assigned data' });
  }
});

module.exports = router;

