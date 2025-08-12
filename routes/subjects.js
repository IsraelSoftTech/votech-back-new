const express = require('express');
const { Pool } = require('pg');
require('dotenv').config();

const router = express.Router();
const pool = new Pool({
  connectionString: process.env.DATABASE_URL
});

// Activity logging function
const logUserActivity = async (userId, activityType, activityDescription, entityType = null, entityId = null, entityName = null, ipAddress = null, userAgent = null) => {
  try {
    await pool.query(`
      INSERT INTO user_activities (user_id, activity_type, activity_description, entity_type, entity_id, entity_name, ip_address, user_agent)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
    `, [userId, activityType, activityDescription, entityType, entityId, entityName, ipAddress, userAgent]);
  } catch (error) {
    console.error('Error logging user activity:', error);
  }
};

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

// Admin authorization middleware
const requireAdmin = (req, res, next) => {
  if (!['Admin1', 'Admin2', 'Admin3', 'Admin4', 'admin', 'Dean'].includes(req.user.role)) {
    return res.status(403).json({ error: 'Access denied. Admin privileges required.' });
  }
  next();
};

// Initialize subjects table if it doesn't exist
const initializeSubjectsTable = async () => {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS subjects (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL UNIQUE,
        code VARCHAR(50) UNIQUE,
        description TEXT,
        credits INTEGER DEFAULT 0,
        department VARCHAR(100),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);

    // Check if required columns exist, add them if they don't
    const columns = await pool.query(`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name = 'subjects' AND column_name IN ('description', 'credits', 'department', 'updated_at')
    `);
    
    const existingColumns = columns.rows.map(row => row.column_name);
    
    if (!existingColumns.includes('description')) {
      await pool.query('ALTER TABLE subjects ADD COLUMN description TEXT');
    }
    if (!existingColumns.includes('credits')) {
      await pool.query('ALTER TABLE subjects ADD COLUMN credits INTEGER DEFAULT 0');
    }
    if (!existingColumns.includes('department')) {
      await pool.query('ALTER TABLE subjects ADD COLUMN department VARCHAR(100)');
    }
    if (!existingColumns.includes('updated_at')) {
      await pool.query('ALTER TABLE subjects ADD COLUMN updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP');
    }

    console.log('Subjects table initialized with correct schema');
  } catch (error) {
    console.error('Error initializing subjects table:', error);
  }
};

// Initialize table on module load
initializeSubjectsTable();

// Get all subjects
router.get('/', authenticateToken, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT s.*, 
             CASE WHEN cs.subject_id IS NOT NULL THEN true ELSE false END as assigned
      FROM subjects s
      LEFT JOIN class_subjects cs ON s.id = cs.subject_id
      ORDER BY s.name
    `);
    
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching subjects:', error);
    res.status(500).json({ error: 'Failed to fetch subjects' });
  }
});

// Get subject by ID
router.get('/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query('SELECT * FROM subjects WHERE id = $1', [id]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Subject not found' });
    }
    
    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error fetching subject:', error);
    res.status(500).json({ error: 'Failed to fetch subject' });
  }
});

// Create new subject (admin only)
router.post('/', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { name, code, description, credits, department } = req.body;
    const ipAddress = req.ip || req.connection.remoteAddress;
    const userAgent = req.get('User-Agent');

    if (!name) {
      return res.status(400).json({ error: 'Subject name is required' });
    }

    // Check if subject name already exists
    const existingSubject = await pool.query('SELECT id FROM subjects WHERE name = $1', [name]);
    if (existingSubject.rows.length > 0) {
      return res.status(400).json({ error: 'Subject with this name already exists' });
    }

    // Check if subject code already exists (if provided)
    if (code) {
      const existingCode = await pool.query('SELECT id FROM subjects WHERE code = $1', [code]);
      if (existingCode.rows.length > 0) {
        return res.status(400).json({ error: 'Subject with this code already exists' });
      }
    }

    const result = await pool.query(
      `INSERT INTO subjects (name, code, description, credits, department) 
       VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [name, code, description, credits || 0, department]
    );

    // Log the activity
    await logUserActivity(req.user.id, 'create', `Created subject: ${name}`, 'subject', result.rows[0].id, name, ipAddress, userAgent);

    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('Error creating subject:', error);
    res.status(500).json({ error: 'Failed to create subject' });
  }
});

// Update subject (admin only)
router.put('/:id', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { name, code, description, credits, department } = req.body;
    const ipAddress = req.ip || req.connection.remoteAddress;
    const userAgent = req.get('User-Agent');

    if (!name) {
      return res.status(400).json({ error: 'Subject name is required' });
    }

    // Check if subject exists
    const existingSubject = await pool.query('SELECT * FROM subjects WHERE id = $1', [id]);
    if (existingSubject.rows.length === 0) {
      return res.status(404).json({ error: 'Subject not found' });
    }

    // Check if new name conflicts with existing subjects (excluding current subject)
    const nameConflict = await pool.query('SELECT id FROM subjects WHERE name = $1 AND id != $2', [name, id]);
    if (nameConflict.rows.length > 0) {
      return res.status(400).json({ error: 'Subject with this name already exists' });
    }

    // Check if new code conflicts with existing subjects (excluding current subject)
    if (code) {
      const codeConflict = await pool.query('SELECT id FROM subjects WHERE code = $1 AND id != $2', [code, id]);
      if (codeConflict.rows.length > 0) {
        return res.status(400).json({ error: 'Subject with this code already exists' });
      }
    }

    const result = await pool.query(
      `UPDATE subjects SET 
        name = $1, code = $2, description = $3, credits = $4, 
        department = $5, updated_at = CURRENT_TIMESTAMP
       WHERE id = $6 RETURNING *`,
      [name, code, description, credits || 0, department, id]
    );

    // Log the activity
    await logUserActivity(req.user.id, 'update', `Updated subject: ${name}`, 'subject', id, name, ipAddress, userAgent);

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error updating subject:', error);
    res.status(500).json({ error: 'Failed to update subject' });
  }
});

// Delete subject (admin only)
router.delete('/:id', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const ipAddress = req.ip || req.connection.remoteAddress;
    const userAgent = req.get('User-Agent');

    // Check if subject exists
    const existingSubject = await pool.query('SELECT * FROM subjects WHERE id = $1', [id]);
    if (existingSubject.rows.length === 0) {
      return res.status(404).json({ error: 'Subject not found' });
    }

    // Check if subject is assigned to any classes
    const classAssignments = await pool.query('SELECT COUNT(*) FROM class_subjects WHERE subject_id = $1', [id]);
    if (parseInt(classAssignments.rows[0].count) > 0) {
      return res.status(400).json({ error: 'Cannot delete subject. It is assigned to one or more classes.' });
    }

    // Check if subject is used in timetables
    const timetableUsage = await pool.query('SELECT COUNT(*) FROM timetable_entries WHERE subject_id = $1', [id]);
    if (parseInt(timetableUsage.rows[0].count) > 0) {
      return res.status(400).json({ error: 'Cannot delete subject. It is used in timetables.' });
    }

    // Log the activity before deletion
    await logUserActivity(req.user.id, 'delete', `Deleted subject: ${existingSubject.rows[0].name}`, 'subject', id, existingSubject.rows[0].name, ipAddress, userAgent);

    await pool.query('DELETE FROM subjects WHERE id = $1', [id]);

    res.json({ message: 'Subject deleted successfully' });
  } catch (error) {
    console.error('Error deleting subject:', error);
    res.status(500).json({ error: 'Failed to delete subject' });
  }
});

// Get subjects by department
router.get('/department/:department', authenticateToken, async (req, res) => {
  try {
    const { department } = req.params;
    const result = await pool.query(
      'SELECT * FROM subjects WHERE department = $1 ORDER BY name',
      [department]
    );
    
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching subjects by department:', error);
    res.status(500).json({ error: 'Failed to fetch subjects by department' });
  }
});

// Search subjects
router.get('/search/:query', authenticateToken, async (req, res) => {
  try {
    const { query } = req.params;
    const searchQuery = `%${query}%`;
    
    const result = await pool.query(
      `SELECT * FROM subjects 
       WHERE name ILIKE $1 OR code ILIKE $1 OR description ILIKE $1
       ORDER BY name`,
      [searchQuery]
    );
    
    res.json(result.rows);
  } catch (error) {
    console.error('Error searching subjects:', error);
    res.status(500).json({ error: 'Failed to search subjects' });
  }
});

module.exports = router; 