const express = require('express');
const multer = require('multer');
const XLSX = require('xlsx');
const { pool, authenticateToken, logUserActivity, getIpAddress, getUserAgent, isAdminLike } = require('./utils');

const router = express.Router();

// Configure multer for file uploads
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB limit
  },
});

// Helper function to parse Excel serial date or string to yyyy-mm-dd
function parseExcelDate(excelDate) {
  if (!excelDate) return null;
  
  if (typeof excelDate === 'number') {
    // Excel serial date
    const date = new Date((excelDate - 25569) * 86400 * 1000);
    return date.toISOString().split('T')[0];
  } else if (typeof excelDate === 'string') {
    // Try to parse as date string
    const date = new Date(excelDate);
    if (!isNaN(date.getTime())) {
      return date.toISOString().split('T')[0];
    }
  }
  return null;
}

// Get students analytics - daily
router.get('/analytics/daily', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT 
        DATE(created_at) as date,
        COUNT(*) as new_students
      FROM students 
      WHERE created_at >= CURRENT_DATE - INTERVAL '30 days'
      GROUP BY DATE(created_at)
      ORDER BY date DESC
    `);
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching daily analytics:', error);
    res.status(500).json({ error: 'Failed to fetch daily analytics' });
  }
});

// Get students analytics - monthly
router.get('/analytics/monthly', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT 
        DATE_TRUNC('month', created_at) as month,
        COUNT(*) as new_students
      FROM students 
      WHERE created_at >= CURRENT_DATE - INTERVAL '12 months'
      GROUP BY DATE_TRUNC('month', created_at)
      ORDER BY month DESC
    `);
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching monthly analytics:', error);
    res.status(500).json({ error: 'Failed to fetch monthly analytics' });
  }
});

// Search students
router.get('/search', authenticateToken, async (req, res) => {
  const userId = req.user.id;
  const userRole = req.user.role;
  const { query, class_id } = req.query;

  try {
    let sql = `
      SELECT s.*, c.name as class_name 
      FROM students s 
      LEFT JOIN classes c ON s.class_id = c.id 
      WHERE 1=1
    `;
    const params = [];
    let paramCount = 0;

    if (query) {
      paramCount++;
      sql += ` AND (s.full_name ILIKE $${paramCount} OR s.student_id ILIKE $${paramCount} OR s.contact ILIKE $${paramCount})`;
      params.push(`%${query}%`);
    }

    if (class_id) {
      paramCount++;
      sql += ` AND s.class_id = $${paramCount}`;
      params.push(class_id);
    }

    // Add role-based filtering
    if (!isAdminLike(userRole)) {
      paramCount++;
      sql += ` AND s.user_id = $${paramCount}`;
      params.push(userId);
    }

    sql += ' ORDER BY s.full_name LIMIT 50';

    const result = await pool.query(sql, params);
    res.json(result.rows);
  } catch (error) {
    console.error('Error searching students:', error);
    res.status(500).json({ error: 'Failed to search students' });
  }
});

// Get student picture
router.get('/:id/picture', async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query(
      'SELECT photo FROM students WHERE id = $1',
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Student not found' });
    }

    const student = result.rows[0];
    if (!student.photo) {
      return res.status(404).json({ error: 'No photo found' });
    }

    // Set appropriate headers
    res.setHeader('Content-Type', 'image/jpeg');
    res.setHeader('Content-Length', student.photo.length);
    res.send(student.photo);
  } catch (error) {
    console.error('Error fetching student picture:', error);
    res.status(500).json({ error: 'Failed to fetch student picture' });
  }
});

// Create student
router.post('/', upload.single('photo'), async (req, res) => {
  try {
    const {
      full_name,
      student_id,
      date_of_birth,
      gender,
      contact,
      email,
      address,
      parent_name,
      parent_contact,
      parent_email,
      class_id,
      user_id,
      academic_year_id
    } = req.body;

    if (!full_name || !student_id) {
      return res.status(400).json({ error: 'Full name and student ID are required' });
    }

    // Check if student ID already exists
    const existingStudent = await pool.query(
      'SELECT * FROM students WHERE student_id = $1',
      [student_id]
    );

    if (existingStudent.rows.length > 0) {
      return res.status(400).json({ error: 'Student ID already exists' });
    }

    // Prepare photo data
    let photoData = null;
    if (req.file) {
      photoData = req.file.buffer;
    }

    // Insert student
    const result = await pool.query(
      `INSERT INTO students (
        full_name, student_id, date_of_birth, gender, contact, email, 
        address, parent_name, parent_contact, parent_email, class_id, 
        user_id, academic_year_id, photo
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14) 
      RETURNING *`,
      [
        full_name, student_id, date_of_birth, gender, contact, email,
        address, parent_name, parent_contact, parent_email, class_id,
        user_id, academic_year_id, photoData
      ]
    );

    const student = result.rows[0];

    // Log activity
    const ipAddress = getIpAddress(req);
    const userAgent = getUserAgent(req);
    await logUserActivity(
      user_id || 1,
      'create',
      `Created student: ${full_name} (${student_id})`,
      'student',
      student.id,
      full_name,
      ipAddress,
      userAgent
    );

    res.status(201).json({
      message: 'Student created successfully',
      student: {
        id: student.id,
        full_name: student.full_name,
        student_id: student.student_id,
        class_id: student.class_id
      }
    });
  } catch (error) {
    console.error('Error creating student:', error);
    res.status(500).json({ error: 'Failed to create student' });
  }
});

// Get all students
router.get('/', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT s.*, c.name as class_name 
      FROM students s 
      LEFT JOIN classes c ON s.class_id = c.id 
      ORDER BY s.full_name
    `);
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching students:', error);
    res.status(500).json({ error: 'Failed to fetch students' });
  }
});

// Delete student
router.delete('/:id', async (req, res) => {
  const { id } = req.params;
  try {
    // Get student info before deleting
    const studentResult = await pool.query(
      'SELECT full_name, student_id FROM students WHERE id = $1',
      [id]
    );
    if (studentResult.rows.length === 0) {
      return res.status(404).json({ error: 'Student not found' });
    }

    const studentName = studentResult.rows[0].full_name;
    const studentId = studentResult.rows[0].student_id;

    const result = await pool.query(
      'DELETE FROM students WHERE id = $1 RETURNING *',
      [id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Student not found' });
    }

    // Log activity if user is authenticated
    if (req.user) {
      const ipAddress = getIpAddress(req);
      const userAgent = getUserAgent(req);
      await logUserActivity(
        req.user.id,
        'delete',
        `Deleted student: ${studentName} (${studentId})`,
        'student',
        id,
        studentName,
        ipAddress,
        userAgent
      );
    }

    res.json({ message: 'Student deleted successfully' });
  } catch (error) {
    console.error('Error deleting student:', error);
    res.status(500).json({ error: 'Failed to delete student' });
  }
});

// Import students from Excel
router.post('/import', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    const workbook = XLSX.read(req.file.buffer, { type: 'buffer' });
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];
    const data = XLSX.utils.sheet_to_json(worksheet);

    if (data.length === 0) {
      return res.status(400).json({ error: 'No data found in file' });
    }

    const results = [];
    const errors = [];

    for (let i = 0; i < data.length; i++) {
      const row = data[i];
      try {
        const {
          'Full Name': full_name,
          'Student ID': student_id,
          'Date of Birth': date_of_birth,
          'Gender': gender,
          'Contact': contact,
          'Email': email,
          'Address': address,
          'Parent Name': parent_name,
          'Parent Contact': parent_contact,
          'Parent Email': parent_email,
          'Class': class_name
        } = row;

        if (!full_name || !student_id) {
          errors.push(`Row ${i + 2}: Missing required fields (Full Name or Student ID)`);
          continue;
        }

        // Check if student ID already exists
        const existingStudent = await pool.query(
          'SELECT * FROM students WHERE student_id = $1',
          [student_id]
        );

        if (existingStudent.rows.length > 0) {
          errors.push(`Row ${i + 2}: Student ID ${student_id} already exists`);
          continue;
        }

        // Get class ID by name
        let class_id = null;
        if (class_name) {
          const classResult = await pool.query(
            'SELECT id FROM classes WHERE name = $1',
            [class_name]
          );
          if (classResult.rows.length > 0) {
            class_id = classResult.rows[0].id;
          }
        }

        // Parse date
        const parsedDate = parseExcelDate(date_of_birth);

        // Insert student
        const result = await pool.query(
          `INSERT INTO students (
            full_name, student_id, date_of_birth, gender, contact, email,
            address, parent_name, parent_contact, parent_email, class_id
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) 
          RETURNING id, full_name, student_id`,
          [
            full_name, student_id, parsedDate, gender, contact, email,
            address, parent_name, parent_contact, parent_email, class_id
          ]
        );

        results.push(result.rows[0]);
      } catch (error) {
        errors.push(`Row ${i + 2}: ${error.message}`);
      }
    }

    res.json({
      message: `Import completed. ${results.length} students imported successfully.`,
      imported: results,
      errors: errors
    });
  } catch (error) {
    console.error('Error importing students:', error);
    res.status(500).json({ error: 'Failed to import students' });
  }
});

module.exports = router;

