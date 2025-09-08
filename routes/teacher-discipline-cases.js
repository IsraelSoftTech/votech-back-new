const express = require('express');
require('dotenv').config();
const { pool, authenticateToken } = require('./utils');

const router = express.Router();

// Ensure table/columns exist to avoid missing-column errors on existing DBs
(async function ensureTeacherCasesSchema() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS teacher_discipline_cases (
        id SERIAL PRIMARY KEY,
        teacher_id INTEGER,
        class_id INTEGER NULL,
        case_description TEXT,
        status VARCHAR(32) DEFAULT 'not resolved',
        recorded_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
        recorded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        resolved_at TIMESTAMP NULL,
        resolution_notes TEXT NULL,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
      ALTER TABLE teacher_discipline_cases ADD COLUMN IF NOT EXISTS class_id INTEGER;
      ALTER TABLE teacher_discipline_cases ADD COLUMN IF NOT EXISTS case_description TEXT;
      ALTER TABLE teacher_discipline_cases ADD COLUMN IF NOT EXISTS status VARCHAR(32) DEFAULT 'not resolved';
      ALTER TABLE teacher_discipline_cases ADD COLUMN IF NOT EXISTS recorded_by INTEGER;
      ALTER TABLE teacher_discipline_cases ADD COLUMN IF NOT EXISTS recorded_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP;
      ALTER TABLE teacher_discipline_cases ADD COLUMN IF NOT EXISTS resolved_at TIMESTAMP NULL;
      ALTER TABLE teacher_discipline_cases ADD COLUMN IF NOT EXISTS resolution_notes TEXT NULL;
      ALTER TABLE teacher_discipline_cases ADD COLUMN IF NOT EXISTS updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP;
    `);

    // Ensure teacher_id references users(id) as requested
    // Drop old FK if it exists, then add the correct FK
    await pool.query(`
      DO $$
      BEGIN
        IF EXISTS (
          SELECT 1 FROM information_schema.table_constraints
          WHERE constraint_type = 'FOREIGN KEY'
            AND table_name = 'teacher_discipline_cases'
            AND constraint_name = 'teacher_discipline_cases_teacher_id_fkey'
        ) THEN
          ALTER TABLE teacher_discipline_cases DROP CONSTRAINT teacher_discipline_cases_teacher_id_fkey;
        END IF;
      END $$;
      ALTER TABLE teacher_discipline_cases
      ADD CONSTRAINT teacher_discipline_cases_teacher_id_fkey
      FOREIGN KEY (teacher_id) REFERENCES users(id) ON DELETE CASCADE;
    `);
  } catch (err) {
    console.error('ensureTeacherCasesSchema failed:', err);
  }
})();

// use shared authenticateToken from utils for consistent auth/JWT

// RBAC helpers
const canWrite = (role) => ['Discipline', 'Psychosocialist', 'Psycho'].includes(role);
const canRead = (role) => ['Admin1', 'Discipline', 'Psychosocialist', 'Psycho'].includes(role);

// List all cases (shared visibility)
router.get('/', authenticateToken, async (req, res) => {
  try {
    if (!canRead(req.user.role)) return res.status(403).json({ error: 'Unauthorized' });
    const result = await pool.query(`
      SELECT 
        tdc.id,
        tdc.teacher_id,
        tdc.class_id,
        tdc.case_description,
        tdc.case_description AS description,
        tdc.case_description AS case_name,
        tdc.status,
        tdc.recorded_by,
        tdc.recorded_at,
        tdc.recorded_at AS created_at,
        tdc.resolved_at,
        tdc.resolution_notes,
        u.username as teacher_username,
        u.name as teacher_name
      FROM teacher_discipline_cases tdc
      LEFT JOIN users u ON u.id = tdc.teacher_id
      ORDER BY tdc.recorded_at DESC, tdc.id DESC
    `);
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
    const {
      teacher_id,
      user_id,
      class_id,
      case_description,
      description,
      case_name,
      teacherId,
      userId,
      classId
    } = req.body || {};

    // accept either teacher_id or user_id mapped to users.id
    const rawUserId = userId ?? user_id;
    const rawTeacherId = teacherId ?? teacher_id;
    const teacherIdNum = Number.isInteger(parseInt(rawUserId, 10))
      ? parseInt(rawUserId, 10)
      : parseInt(rawTeacherId, 10);
    const rawDesc = case_description ?? description ?? case_name;
    const trimmedDescription = (rawDesc || '').toString().trim();

    if (!Number.isInteger(teacherIdNum) || teacherIdNum <= 0 || !trimmedDescription) {
      return res.status(400).json({ error: 'teacher_id or user_id (int) and case_description are required' });
    }

    // Validate teacher exists in users table
    const teacherRes = await pool.query('SELECT id FROM users WHERE id = $1', [teacherIdNum]);
    if (teacherRes.rows.length === 0) return res.status(400).json({ error: 'Invalid teacher_id' });

    const recordedBy = Number(req.user?.id) || null;
    if (!recordedBy) return res.status(401).json({ error: 'Unauthenticated' });

    const classIdNum = Number.isInteger(parseInt(classId ?? class_id, 10)) ? parseInt(classId ?? class_id, 10) : null;
    const result = await pool.query(
      `INSERT INTO teacher_discipline_cases (teacher_id, class_id, case_description, status, recorded_by)
       VALUES ($1,$2,$3,'not resolved',$4)
       RETURNING id, teacher_id, class_id, case_description, status, recorded_by, recorded_at, resolved_at, resolution_notes`,
      [teacherIdNum, classIdNum, trimmedDescription, recordedBy]
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
    // Surface common constraint errors to client to aid debugging
    if (e && e.code === '23503') {
      return res.status(400).json({ error: 'Invalid foreign key: teacher_id/user_id or created_by' });
    }
    // include db error code to aid debugging in QA
    return res.status(500).json({ error: 'Failed to create teacher case', code: e?.code || null });
  }
});

// Update case (Discipline/Psycho only, simple fields)
router.put('/:id', authenticateToken, async (req, res) => {
  try {
    if (!canWrite(req.user.role)) return res.status(403).json({ error: 'Unauthorized' });
    const { id } = req.params;
    const { teacher_id, user_id, class_id, case_description, description, case_name, status, resolution_notes } = req.body || {};
    const rawUserId = user_id ?? teacher_id;
    const teacherIdNum = Number.isInteger(parseInt(rawUserId, 10)) ? parseInt(rawUserId, 10) : null;
    const desc = (case_description ?? description ?? case_name) || null;
    const classIdNum = Number.isInteger(parseInt(class_id,10)) ? parseInt(class_id,10) : null;

    const result = await pool.query(
      `UPDATE teacher_discipline_cases 
       SET teacher_id = COALESCE($1, teacher_id),
           class_id = COALESCE($2, class_id),
           case_description = COALESCE($3, case_description),
           status = COALESCE($4, status),
           resolution_notes = COALESCE($5, resolution_notes),
           updated_at = CURRENT_TIMESTAMP
       WHERE id = $6 RETURNING *`,
      [teacherIdNum, classIdNum, desc, status || null, resolution_notes || null, Number(id)]
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
    await pool.query('DELETE FROM teacher_discipline_cases WHERE id = $1', [Number(id)]);
    res.json({ message: 'Teacher discipline case deleted successfully' });
  } catch (e) {
    console.error('Delete teacher case failed:', e);
    res.status(500).json({ error: 'Failed to delete teacher case' });
  }
});

module.exports = router;


