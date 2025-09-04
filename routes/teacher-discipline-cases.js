const express = require('express');
const { Pool } = require('pg');
require('dotenv').config();

const router = express.Router();
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

// Ensure table/columns exist to avoid missing-column errors on existing DBs
(async function ensureTeacherCasesSchema() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS teacher_discipline_cases (
        id SERIAL PRIMARY KEY,
        teacher_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        case_name VARCHAR(200),
        description TEXT,
        created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
      ALTER TABLE teacher_discipline_cases ADD COLUMN IF NOT EXISTS case_name VARCHAR(200);
      ALTER TABLE teacher_discipline_cases ADD COLUMN IF NOT EXISTS description TEXT;
      ALTER TABLE teacher_discipline_cases ADD COLUMN IF NOT EXISTS created_by INTEGER;
      ALTER TABLE teacher_discipline_cases ADD COLUMN IF NOT EXISTS created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP;
      ALTER TABLE teacher_discipline_cases ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP;
    `);
  } catch (err) {
    console.error('ensureTeacherCasesSchema failed:', err);
  }
})();

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

// RBAC helpers
const canWrite = (role) => ['Discipline', 'Psychosocialist', 'Psycho'].includes(role);
const canRead = (role) => ['Admin1', 'Discipline', 'Psychosocialist', 'Psycho'].includes(role);

// List all cases (shared visibility)
router.get('/', authenticateToken, async (req, res) => {
  try {
    if (!canRead(req.user.role)) return res.status(403).json({ error: 'Unauthorized' });
    const result = await pool.query(
      'SELECT tdc.id, tdc.teacher_id, tdc.case_name, tdc.description, tdc.created_by, tdc.created_at, tdc.updated_at, u.username as teacher_username, u.name as teacher_name FROM teacher_discipline_cases tdc LEFT JOIN users u ON u.id = tdc.teacher_id ORDER BY tdc.id DESC'
    );
    res.json(result.rows);
  } catch (e) {
    console.error('List teacher cases failed:', e);
    res.status(500).json({ error: 'Failed to fetch teacher cases' });
  }
});

// Create case (Discipline/Psycho only)
router.post('/', authenticateToken, async (req, res) => {
  try {
    if (!canWrite(req.user.role)) return res.status(403).json({ error: 'Unauthorized' });
    const { teacher_id, case_name, description } = req.body || {};
    const teacherIdNum = Number(teacher_id);
    if (!teacherIdNum || !case_name) return res.status(400).json({ error: 'teacher_id and case_name are required' });

    // Validate teacher exists
    const teacherRes = await pool.query('SELECT id FROM users WHERE id = $1', [teacherIdNum]);
    if (teacherRes.rows.length === 0) return res.status(400).json({ error: 'Invalid teacher_id' });

    // Validate created_by exists, otherwise null
    let createdBy = Number(req.user?.id) || null;
    if (createdBy) {
      const by = await pool.query('SELECT id FROM users WHERE id = $1', [createdBy]);
      if (by.rows.length === 0) createdBy = null;
    }

    const result = await pool.query(
      'INSERT INTO teacher_discipline_cases (teacher_id, case_name, description, created_by) VALUES ($1,$2,$3,$4) RETURNING id, teacher_id, case_name, description, created_by, created_at, updated_at',
      [teacherIdNum, String(case_name), description || null, createdBy]
    );
    const row = result.rows[0];
    // Attach teacher label for immediate UI display
    let teacherLabel = null;
    try {
      const t = await pool.query('SELECT username, name FROM users WHERE id = $1', [teacherIdNum]);
      teacherLabel = t.rows[0]?.name || t.rows[0]?.username || null;
    } catch (_) {}
    res.status(201).json({ ...row, teacher_name: teacherLabel });
  } catch (e) {
    console.error('Create teacher case failed:', e?.stack || e);
    res.status(500).json({ error: 'Failed to create teacher case' });
  }
});

// Update case (Discipline/Psycho only, simple fields)
router.put('/:id', authenticateToken, async (req, res) => {
  try {
    if (!canWrite(req.user.role)) return res.status(403).json({ error: 'Unauthorized' });
    const { id } = req.params;
    const { teacher_id, case_name, description } = req.body || {};
    const result = await pool.query(
      'UPDATE teacher_discipline_cases SET teacher_id = COALESCE($1, teacher_id), case_name = COALESCE($2, case_name), description = COALESCE($3, description), updated_at = CURRENT_TIMESTAMP WHERE id = $4 RETURNING *',
      [teacher_id ? Number(teacher_id) : null, case_name || null, description || null, Number(id)]
    );
    if (result.rows.length === 0) return res.status(404).json({ error: 'Not found' });
    res.json(result.rows[0]);
  } catch (e) {
    console.error('Update teacher case failed:', e);
    res.status(500).json({ error: 'Failed to update teacher case' });
  }
});

// Delete case (Discipline/Psycho only)
router.delete('/:id', authenticateToken, async (req, res) => {
  try {
    if (!canWrite(req.user.role)) return res.status(403).json({ error: 'Unauthorized' });
    const { id } = req.params;
    const del = await pool.query('DELETE FROM teacher_discipline_cases WHERE id = $1', [Number(id)]);
    res.json({ ok: true });
  } catch (e) {
    console.error('Delete teacher case failed:', e);
    res.status(500).json({ error: 'Failed to delete teacher case' });
  }
});

module.exports = router;


