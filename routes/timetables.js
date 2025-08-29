const express = require('express');
const { Pool } = require('pg');
require('dotenv').config();

const router = express.Router();
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

// Auth middleware (copied pattern used elsewhere)
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  if (!authHeader) return res.status(401).json({ error: 'No authorization header' });
  const token = authHeader.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'No token provided' });
  try {
    const jwt = require('jsonwebtoken');
    const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key';
    const user = jwt.verify(token, JWT_SECRET);
    req.user = user;
    next();
  } catch (err) {
    if (err.name === 'TokenExpiredError') return res.status(401).json({ error: 'Token expired' });
    return res.status(403).json({ error: 'Invalid token' });
  }
};

// Ensure tables exist (idempotent)
async function ensureTables() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS timetable_configs (
      id SERIAL PRIMARY KEY,
      config JSONB NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS timetables (
      id SERIAL PRIMARY KEY,
      class_id INTEGER REFERENCES classes(id) ON DELETE CASCADE,
      data JSONB NOT NULL,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(class_id)
    );
    CREATE TABLE IF NOT EXISTS teacher_assignments (
      id SERIAL PRIMARY KEY,
      teacher_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
      class_id INTEGER REFERENCES classes(id) ON DELETE CASCADE,
      subject_id INTEGER REFERENCES subjects(id) ON DELETE CASCADE,
      periods_per_week INTEGER NOT NULL DEFAULT 1,
      created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(teacher_id, class_id, subject_id)
    );
  `);
}
ensureTables().catch(console.error);

// Save (upsert) global timetable config (times, constraints, etc.)
router.post('/settings', authenticateToken, async (req, res) => {
  try {
    const config = req.body || {};
    // Upsert single latest row: keep only one record
    const exists = await pool.query('SELECT id FROM timetable_configs ORDER BY id DESC LIMIT 1');
    if (exists.rows.length > 0) {
      const id = exists.rows[0].id;
      await pool.query('UPDATE timetable_configs SET config = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2', [config, id]);
      return res.json({ id, updated: true });
    } else {
      const ins = await pool.query('INSERT INTO timetable_configs (config) VALUES ($1) RETURNING id', [config]);
      return res.status(201).json({ id: ins.rows[0].id, created: true });
    }
  } catch (err) {
    console.error('Save settings failed:', err);
    res.status(500).json({ error: 'Failed to save timetable settings' });
  }
});

// Get global timetable config
router.get('/settings', authenticateToken, async (req, res) => {
  try {
    const result = await pool.query('SELECT config FROM timetable_configs ORDER BY updated_at DESC, id DESC LIMIT 1');
    if (result.rows.length === 0) return res.json(null);
    res.json(result.rows[0].config);
  } catch (err) {
    console.error('Get settings failed:', err);
    res.status(500).json({ error: 'Failed to fetch timetable settings' });
  }
});

// Save (upsert) teacher assignments (fixed path before param routes)
router.post('/assignments/bulk', authenticateToken, async (req, res) => {
  try {
    const { assignments } = req.body; // [{teacher_id, class_id, subject_id, periods_per_week}]
    if (!Array.isArray(assignments)) return res.status(400).json({ error: 'assignments must be an array' });
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      for (const a of assignments) {
        await client.query(`
          INSERT INTO teacher_assignments (teacher_id, class_id, subject_id, periods_per_week)
          VALUES ($1, $2, $3, $4)
          ON CONFLICT (teacher_id, class_id, subject_id) DO UPDATE SET periods_per_week = EXCLUDED.periods_per_week, updated_at = CURRENT_TIMESTAMP
        `, [Number(a.teacher_id) || null, Number(a.class_id) || null, Number(a.subject_id) || null, Number(a.periods_per_week) || 1]);
      }
      await client.query('COMMIT');
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
    res.json({ ok: true, count: assignments.length });
  } catch (err) {
    console.error('Save assignments failed:', err);
    res.status(500).json({ error: 'Failed to save assignments' });
  }
});

// Get assignments
router.get('/assignments', authenticateToken, async (req, res) => {
  try {
    const { classId, subjectId } = req.query;
    let query = 'SELECT * FROM teacher_assignments';
    const params = [];
    const conds = [];
    if (classId) { params.push(Number(classId)); conds.push(`class_id = $${params.length}`); }
    if (subjectId) { params.push(Number(subjectId)); conds.push(`subject_id = $${params.length}`); }
    if (conds.length > 0) query += ' WHERE ' + conds.join(' AND ');
    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (err) {
    console.error('Get assignments failed:', err);
    res.status(500).json({ error: 'Failed to fetch assignments' });
  }
});

// Save a class timetable
router.post('/class/:classId', authenticateToken, async (req, res) => {
  try {
    const classId = parseInt(req.params.classId, 10);
    if (Number.isNaN(classId)) return res.status(400).json({ error: 'Invalid classId' });
    
    console.log('Raw request body:', req.body);
    console.log('Request body type:', typeof req.body);
    console.log('Request body stringified:', JSON.stringify(req.body));
    
    const data = req.body || {};
    // Saving timetable for class
    
    // Ensure data is a proper object for JSONB storage
    let jsonData;
    if (typeof data === 'string') {
      try {
        jsonData = JSON.parse(data);
      } catch (e) {
        console.error('Failed to parse data as JSON string:', e);
        return res.status(400).json({ error: 'Invalid JSON data' });
      }
    } else if (typeof data === 'object' && data !== null) {
      jsonData = data;
    } else {
      console.error('Invalid data type:', typeof data);
      return res.status(400).json({ error: 'Invalid data format' });
    }
    
    console.log('Final JSON data to save:', jsonData);
    
    const exists = await pool.query('SELECT id FROM timetables WHERE class_id = $1', [classId]);
    if (exists.rows.length > 0) {
      await pool.query('UPDATE timetables SET data = $1, updated_at = CURRENT_TIMESTAMP WHERE class_id = $2', [jsonData, classId]);
      // Updated timetable for class
      return res.json({ class_id: classId, updated: true });
    } else {
      const ins = await pool.query('INSERT INTO timetables (class_id, data) VALUES ($1, $2) RETURNING id', [classId, jsonData]);
      // Created timetable for class
      return res.status(201).json({ id: ins.rows[0].id, class_id: classId, created: true });
    }
  } catch (err) {
    console.error('Save class timetable failed:', err);
    res.status(500).json({ error: 'Failed to save class timetable' });
  }
});

// Get a class timetable
router.get('/class/:classId', authenticateToken, async (req, res) => {
  try {
    const classId = parseInt(req.params.classId, 10);
    if (Number.isNaN(classId)) return res.status(400).json({ error: 'Invalid classId' });
    const result = await pool.query('SELECT data FROM timetables WHERE class_id = $1', [classId]);
    if (result.rows.length === 0) return res.json(null);
    // Retrieved timetable for class
    res.json(result.rows[0].data);
  } catch (err) {
    console.error('Get class timetable failed:', err);
    res.status(500).json({ error: 'Failed to fetch class timetable' });
  }
});

// Get all timetables
router.get('/', authenticateToken, async (req, res) => {
  try {
    const result = await pool.query('SELECT class_id, data FROM timetables');
    console.log('Retrieved all timetables:', result.rows);
    res.json(result.rows);
  } catch (err) {
    console.error('Get all timetables failed:', err);
    res.status(500).json({ error: 'Failed to fetch timetables' });
  }
});

// Delete timetable settings
router.delete('/settings', authenticateToken, async (req, res) => {
  try {
    await pool.query('DELETE FROM timetable_configs');
    res.json({ message: 'Timetable settings deleted successfully' });
  } catch (err) {
    console.error('Delete settings failed:', err);
    res.status(500).json({ error: 'Failed to delete timetable settings' });
  }
});

// Delete all teacher assignments
router.delete('/assignments', authenticateToken, async (req, res) => {
  try {
    await pool.query('DELETE FROM teacher_assignments');
    res.json({ message: 'Teacher assignments deleted successfully' });
  } catch (err) {
    console.error('Delete assignments failed:', err);
    res.status(500).json({ error: 'Failed to delete teacher assignments' });
  }
});

// Delete all timetables
router.delete('/delete-all', authenticateToken, async (req, res) => {
  try {
    await pool.query('DELETE FROM timetables');
    res.json({ message: 'All timetables deleted successfully' });
  } catch (err) {
    console.error('Delete all timetables failed:', err);
    res.status(500).json({ error: 'Failed to delete timetables' });
  }
});

// Save class requirements
router.post('/class-requirements', authenticateToken, async (req, res) => {
  try {
    const { classRequirements } = req.body;
    // Upsert single latest row: keep only one record
    const exists = await pool.query('SELECT id FROM timetable_configs WHERE config->>\'type\' = \'class_requirements\' ORDER BY id DESC LIMIT 1');
    if (exists.rows.length > 0) {
      const id = exists.rows[0].id;
      await pool.query('UPDATE timetable_configs SET config = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2', 
        [{ type: 'class_requirements', data: classRequirements }, id]);
      return res.json({ id, updated: true });
    } else {
      const ins = await pool.query('INSERT INTO timetable_configs (config) VALUES ($1) RETURNING id', 
        [{ type: 'class_requirements', data: classRequirements }]);
      return res.status(201).json({ id: ins.rows[0].id, created: true });
    }
  } catch (err) {
    console.error('Save class requirements failed:', err);
    res.status(500).json({ error: 'Failed to save class requirements' });
  }
});

// Get class requirements
router.get('/class-requirements', authenticateToken, async (req, res) => {
  try {
    const result = await pool.query('SELECT config FROM timetable_configs WHERE config->>\'type\' = \'class_requirements\' ORDER BY updated_at DESC, id DESC LIMIT 1');
    if (result.rows.length === 0) return res.json({});
    res.json(result.rows[0].config.data || {});
  } catch (err) {
    console.error('Get class requirements failed:', err);
    res.status(500).json({ error: 'Failed to fetch class requirements' });
  }
});

// Save heavy subjects
router.post('/heavy-subjects', authenticateToken, async (req, res) => {
  try {
    const { heavySubjectIds } = req.body;
    // Upsert single latest row: keep only one record
    const exists = await pool.query('SELECT id FROM timetable_configs WHERE config->>\'type\' = \'heavy_subjects\' ORDER BY id DESC LIMIT 1');
    if (exists.rows.length > 0) {
      const id = exists.rows[0].id;
      await pool.query('UPDATE timetable_configs SET config = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2', 
        [{ type: 'heavy_subjects', data: heavySubjectIds }, id]);
      return res.json({ id, updated: true });
    } else {
      const ins = await pool.query('INSERT INTO timetable_configs (config) VALUES ($1) RETURNING id', 
        [{ type: 'heavy_subjects', data: heavySubjectIds }]);
      return res.status(201).json({ id: ins.rows[0].id, created: true });
    }
  } catch (err) {
    console.error('Save heavy subjects failed:', err);
    res.status(500).json({ error: 'Failed to save heavy subjects' });
  }
});

// Get heavy subjects
router.get('/heavy-subjects', authenticateToken, async (req, res) => {
  try {
    const result = await pool.query('SELECT config FROM timetable_configs WHERE config->>\'type\' = \'heavy_subjects\' ORDER BY updated_at DESC, id DESC LIMIT 1');
    if (result.rows.length === 0) return res.json([]);
    res.json(result.rows[0].config.data || []);
  } catch (err) {
    console.error('Get heavy subjects failed:', err);
    res.status(500).json({ error: 'Failed to fetch heavy subjects' });
  }
});

// Delete class requirements
router.delete('/class-requirements', authenticateToken, async (req, res) => {
  try {
    await pool.query('DELETE FROM timetable_configs WHERE config->>\'type\' = \'class_requirements\'');
    res.json({ message: 'Class requirements deleted successfully' });
  } catch (err) {
    console.error('Delete class requirements failed:', err);
    res.status(500).json({ error: 'Failed to delete class requirements' });
  }
});

// Delete heavy subjects
router.delete('/heavy-subjects', authenticateToken, async (req, res) => {
  try {
    await pool.query('DELETE FROM timetable_configs WHERE config->>\'type\' = \'heavy_subjects\'');
    res.json({ message: 'Heavy subjects deleted successfully' });
  } catch (err) {
    console.error('Delete heavy subjects failed:', err);
    res.status(500).json({ error: 'Failed to delete heavy subjects' });
  }
});

module.exports = router; 