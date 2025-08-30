const express = require('express');
const { Pool } = require('pg');
require('dotenv').config();

const router = express.Router();
const pool = new Pool({
  connectionString: process.env.DATABASE_URL
});

// Authentication middleware
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  if (!authHeader) {
    return res.status(401).json({ error: 'No authorization header' });
  }

  const token = authHeader.split(' ')[1];
  if (!token) {
    return res.status(401).json({ error: 'No token provided' });
  }

  // Special handling for Admin3 hardcoded token
  if (token === 'admin3-special-token-2024') {
    // Create a mock user object for Admin3
    req.user = {
      id: 999,
      username: 'Admin3',
      role: 'Admin3',
      name: 'System Administrator'
    };
    return next();
  }

  try {
    const jwt = require('jsonwebtoken');
    const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key';
    const user = jwt.verify(token, JWT_SECRET);
    req.user = user;
    next();
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Token expired' });
    }
    return res.status(403).json({ error: 'Invalid token' });
  }
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
    // Lessons table initialized
  } catch (error) {
    console.error('Error initializing lessons table:', error);
  }
};

// Initialize table on module load
initializeLessonsTable();

// Create a new lesson
router.post('/', authenticateToken, async (req, res) => {
  try {
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
      resources
    } = req.body;

    if (!title) {
      return res.status(400).json({ error: 'Title is required' });
    }

    const result = await pool.query(
      `INSERT INTO lessons 
       (user_id, title, subject, class_name, week, period_type, objectives, content, activities, assessment, resources) 
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) 
       RETURNING *`,
      [
        req.user.id,
        title,
        subject,
        class_name,
        week,
        period_type || 'weekly',
        objectives,
        content,
        activities,
        assessment,
        resources
      ]
    );

    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('Error creating lesson:', error);
    res.status(500).json({ error: 'Failed to create lesson' });
  }
});

// Get my lessons (for teachers)
router.get('/my', authenticateToken, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM lessons WHERE user_id = $1 ORDER BY created_at DESC',
      [req.user.id]
    );
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching my lessons:', error);
    res.status(500).json({ error: 'Failed to fetch lessons' });
  }
});

// Get all lessons (for admins)
router.get('/all', authenticateToken, async (req, res) => {
  try {
    console.log('Get all lessons request from user:', req.user.id, 'Role:', req.user.role);
    
    // Check if user is admin or dean
    if (!['Admin1', 'Admin2', 'Admin3', 'Admin4', 'admin', 'Dean'].includes(req.user.role)) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const result = await pool.query(
      `SELECT 
        l.*,
        u.name as teacher_name,
        u.username as teacher_username,
        u.role as teacher_role
       FROM lessons l 
       LEFT JOIN users u ON l.user_id = u.id 
       ORDER BY l.created_at DESC`
    );
    
    console.log('Found', result.rows.length, 'lessons');
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching all lessons:', error);
    res.status(500).json({ error: 'Failed to fetch all lessons' });
  }
});

// Update a lesson
router.put('/:id', authenticateToken, async (req, res) => {
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
      resources
    } = req.body;

    // Check if lesson belongs to user or user is admin
    const existingLesson = await pool.query(
      'SELECT * FROM lessons WHERE id = $1',
      [lessonId]
    );

    if (existingLesson.rows.length === 0) {
      return res.status(404).json({ error: 'Lesson not found' });
    }

    // Only allow owner or admin to edit
    if (existingLesson.rows[0].user_id !== req.user.id && 
        !['Admin1', 'Admin2', 'Admin3', 'Admin4', 'admin', 'Dean'].includes(req.user.role)) {
      return res.status(403).json({ error: 'Access denied' });
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
        period_type || 'weekly',
        objectives,
        content,
        activities,
        assessment,
        resources,
        lessonId
      ]
    );

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error updating lesson:', error);
    res.status(500).json({ error: 'Failed to update lesson' });
  }
});

// Delete a lesson
router.delete('/:id', authenticateToken, async (req, res) => {
  try {
    const lessonId = parseInt(req.params.id);

    // Check if lesson exists and user has permission
    const existingLesson = await pool.query(
      'SELECT * FROM lessons WHERE id = $1',
      [lessonId]
    );

    if (existingLesson.rows.length === 0) {
      return res.status(404).json({ error: 'Lesson not found' });
    }

    // Only allow owner or admin to delete
    if (existingLesson.rows[0].user_id !== req.user.id && 
        !['Admin1', 'Admin2', 'Admin3', 'Admin4', 'admin', 'Dean'].includes(req.user.role)) {
      return res.status(403).json({ error: 'Access denied' });
    }

    await pool.query('DELETE FROM lessons WHERE id = $1', [lessonId]);
    res.json({ message: 'Lesson deleted successfully' });
  } catch (error) {
    console.error('Error deleting lesson:', error);
    res.status(500).json({ error: 'Failed to delete lesson' });
  }
});

// Review lesson (admin only)
router.put('/:id/review', authenticateToken, async (req, res) => {
  try {
    // Check if user is admin or dean
    if (!['Admin1', 'Admin2', 'Admin3', 'Admin4', 'admin', 'Dean'].includes(req.user.role)) {
      return res.status(403).json({ error: 'Access denied' });
    }

    const lessonId = parseInt(req.params.id);
    const { status, admin_comment } = req.body;

    if (!['approved', 'rejected', 'pending'].includes(status)) {
      return res.status(400).json({ error: 'Invalid status' });
    }

    const result = await pool.query(
      `UPDATE lessons SET 
        status = $1, admin_comment = $2, reviewed_at = CURRENT_TIMESTAMP, reviewed_by = $3
       WHERE id = $4 RETURNING *`,
      [status, admin_comment, req.user.id, lessonId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Lesson not found' });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error reviewing lesson:', error);
    res.status(500).json({ error: 'Failed to review lesson' });
  }
});

module.exports = router; 