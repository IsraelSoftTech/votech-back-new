const express = require('express');
const { pool, authenticateToken } = require('./utils');

const router = express.Router();

// Get all users for monitoring
router.get('/users', authenticateToken, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT 
        u.id, u.name, u.username, u.role, u.email, u.contact,
        u.created_at, u.last_login, u.suspended,
        COUNT(ua.id) as activity_count,
        COUNT(us.id) as session_count
      FROM users u
      LEFT JOIN user_activities ua ON u.id = ua.user_id
      LEFT JOIN user_sessions us ON u.id = us.user_id
      GROUP BY u.id
      ORDER BY u.created_at DESC
    `);
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching users for monitoring:', error);
    res.status(500).json({ error: 'Failed to fetch users for monitoring' });
  }
});

// Get user activities
router.get('/user-activities', authenticateToken, async (req, res) => {
  try {
    const { limit = 100, offset = 0 } = req.query;
    const result = await pool.query(`
      SELECT 
        ua.*,
        u.name as user_name,
        u.username
      FROM user_activities ua
      JOIN users u ON ua.user_id = u.id
      ORDER BY ua.created_at DESC
      LIMIT $1 OFFSET $2
    `, [limit, offset]);
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching user activities:', error);
    res.status(500).json({ error: 'Failed to fetch user activities' });
  }
});

// Get user sessions
router.get('/user-sessions', authenticateToken, async (req, res) => {
  try {
    const { limit = 100, offset = 0 } = req.query;
    const result = await pool.query(`
      SELECT 
        us.*,
        u.name as user_name,
        u.username
      FROM user_sessions us
      JOIN users u ON us.user_id = u.id
      ORDER BY us.created_at DESC
      LIMIT $1 OFFSET $2
    `, [limit, offset]);
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching user sessions:', error);
    res.status(500).json({ error: 'Failed to fetch user sessions' });
  }
});

// Clear all monitoring data
router.get('/clear-all', authenticateToken, async (req, res) => {
  try {
    await pool.query('DELETE FROM user_activities');
    await pool.query('DELETE FROM user_sessions');
    res.json({ message: 'All monitoring data cleared successfully' });
  } catch (error) {
    console.error('Error clearing monitoring data:', error);
    res.status(500).json({ error: 'Failed to clear monitoring data' });
  }
});

module.exports = router;
