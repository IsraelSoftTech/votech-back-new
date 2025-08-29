const express = require('express');
const multer = require('multer');
const { pool, authenticateToken } = require('./utils');
const ftpService = require('../ftp-service');
const path = require('path');

const router = express.Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

// List students
router.get('/', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT s.*, c.name as class_name, sp.name as specialty_name 
      FROM students s 
      LEFT JOIN classes c ON s.class_id = c.id 
      LEFT JOIN specialties sp ON s.specialty_id = sp.id 
      ORDER BY s.full_name
    `);
    res.json(result.rows);
  } catch (e) {
    res.status(500).json({ error: 'Failed to fetch students' });
  }
});

// Create student
router.post('/', authenticateToken, upload.single('photo'), async (req, res) => {
  const body = req.body || {};
  const full_name = body.full_name || body.fullName;
  const student_id = body.student_id || body.studentId;
  if (!full_name || !student_id) return res.status(400).json({ error: 'Full name and Student ID are required' });
  const mapDate = (d) => (d ? new Date(d).toISOString().slice(0, 10) : null);
  const registration_date = mapDate(body.registration_date || body.regDate) || new Date().toISOString().slice(0, 10);
  const date_of_birth = mapDate(body.date_of_birth || body.dob) || mapDate(body.regDate) || new Date().toISOString().slice(0,10);
  const insert = {
    full_name,
    student_id,
    registration_date,
    sex: body.sex || 'U',
    date_of_birth,
    place_of_birth: body.place_of_birth || body.pob || 'Unknown',
    father_name: body.father_name || body.father,
    mother_name: body.mother_name || body.mother,
    class_id: body.class_id || body.class || null,
    specialty_id: body.specialty_id || body.dept || null,
    academic_year_id: body.academic_year_id || body.academicYear || null,
    guardian_contact: body.guardian_contact || body.fatherContact || null,
    mother_contact: body.mother_contact || body.motherContact || null,
    photo_url: null,
  };
  try {
    // Upload photo to FTP if provided
    if (req.file) {
      const ext = path.extname(req.file.originalname || '.jpg') || '.jpg';
      const remotePath = `students/photos/${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`;
      insert.photo_url = await ftpService.uploadBuffer(req.file.buffer, remotePath);
    }

    // Detect existing columns in DB and insert only those
    const colsRes = await pool.query("SELECT column_name FROM information_schema.columns WHERE table_name='students'");
    const existingCols = new Set(colsRes.rows.map(r => r.column_name));
    const filtered = {};
    Object.entries(insert).forEach(([k, v]) => {
      if (existingCols.has(k) && v !== undefined) filtered[k] = v;
    });
    const columns = Object.keys(filtered);
    const values = Object.values(filtered);
    const placeholders = columns.map((_, i) => `$${i + 1}`);
    const result = await pool.query(
      `INSERT INTO students (${columns.join(',')}) VALUES (${placeholders.join(',')}) RETURNING *`,
      values
    );
    res.status(201).json({ message: 'Student created successfully', student: result.rows[0] });
  } catch (e) {
    console.error('Create student error:', e);
    res.status(500).json({ error: e.detail || e.message || 'Failed to create student' });
  }
});

// Update student
router.put('/:id', authenticateToken, upload.single('photo'), async (req, res) => {
  const { id } = req.params;
  const body = req.body || {};
  const mapDate = (d) => (d ? new Date(d).toISOString().slice(0, 10) : undefined);
  const update = {
    full_name: body.full_name || body.fullName,
    student_id: body.student_id || body.studentId,
    registration_date: mapDate(body.registration_date || body.regDate),
    sex: body.sex,
    date_of_birth: mapDate(body.date_of_birth || body.dob),
    place_of_birth: body.place_of_birth || body.pob,
    father_name: body.father_name || body.father,
    mother_name: body.mother_name || body.mother,
    class_id: body.class_id || body.class,
    specialty_id: body.specialty_id || body.dept,
    academic_year_id: body.academic_year_id || body.academicYear,
    guardian_contact: body.guardian_contact || body.fatherContact,
    mother_contact: body.mother_contact || body.motherContact,
  };
  try {
    if (req.file) {
      const ext = path.extname(req.file.originalname || '.jpg') || '.jpg';
      const remotePath = `students/photos/${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`;
      update.photo_url = await ftpService.uploadBuffer(req.file.buffer, remotePath);
    }
    // Only update columns that exist
    const colsRes = await pool.query("SELECT column_name FROM information_schema.columns WHERE table_name='students'");
    const existingCols = new Set(colsRes.rows.map(r => r.column_name));
    const fields = [];
    const vals = [];
    let idx = 0;
    Object.entries(update).forEach(([k, v]) => {
      if (existingCols.has(k) && v !== undefined && v !== null && v !== '') {
        idx += 1; fields.push(`${k}=$${idx}`); vals.push(v);
      }
    });
    if (!fields.length) return res.status(400).json({ error: 'No fields to update' });
    idx += 1; vals.push(id);
    const result = await pool.query(`UPDATE students SET ${fields.join(',')} WHERE id=$${idx} RETURNING *`, vals);
    res.json({ message: 'Student updated successfully', student: result.rows[0] });
  } catch (e) {
    console.error('Update student error:', e);
    res.status(500).json({ error: e.detail || e.message || 'Failed to update student' });
  }
});

// Delete student
router.delete('/:id', authenticateToken, async (req, res) => {
  const { id } = req.params;
  try {
    await pool.query('DELETE FROM students WHERE id=$1', [id]);
    res.json({ message: 'Student deleted successfully' });
  } catch (e) {
    res.status(500).json({ error: 'Failed to delete student' });
  }
});

module.exports = router;


