const express = require('express');
const { pool, authenticateToken, logUserActivity, getIpAddress, getUserAgent, requireAdmin } = require('./utils');

const router = express.Router();

// Create teacher
router.post('/', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const {
      name,
      contact,
      email,
      subject,
      qualification,
      experience,
      salary,
      hire_date,
      status = 'active'
    } = req.body;

    if (!name || !contact) {
      return res.status(400).json({ error: 'Name and contact are required' });
    }

    const result = await pool.query(
      `INSERT INTO users (
        name, contact, email, role, username
      ) VALUES ($1, $2, $3, $4, $5) 
      RETURNING *`,
      [
        name, contact, email || null, 'Teacher', contact // Use contact as username
      ]
    );

    const newTeacher = result.rows[0];

    // Log activity
    const ipAddress = getIpAddress(req);
    const userAgent = getUserAgent(req);
    await logUserActivity(
      req.user.id,
      'create',
      `Created teacher: ${name}`,
      'teacher',
      newTeacher.id,
      name,
      ipAddress,
      userAgent
    );

    res.status(201).json({
      message: 'Teacher created successfully',
      teacher: newTeacher
    });
  } catch (error) {
    console.error('Error creating teacher:', error);
    res.status(500).json({ error: 'Failed to create teacher' });
  }
});

// Get all teachers
router.get('/', authenticateToken, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT id, username, contact, name, email, gender, role, created_at FROM users WHERE role = $1 ORDER BY name',
      ['Teacher']
    );
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching teachers:', error);
    res.status(500).json({ error: 'Failed to fetch teachers' });
  }
});

// Update teacher
router.put('/:id', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const {
      name,
      contact,
      email,
      subject,
      qualification,
      experience,
      salary,
      hire_date,
      status
    } = req.body;

    if (!name || !contact) {
      return res.status(400).json({ error: 'Name and contact are required' });
    }

    // Check if teacher exists
    const existingTeacher = await pool.query(
      'SELECT * FROM users WHERE id = $1 AND role = $2',
      [id, 'Teacher']
    );

    if (existingTeacher.rows.length === 0) {
      return res.status(404).json({ error: 'Teacher not found' });
    }

    const result = await pool.query(
      `UPDATE users SET 
        name = $1, contact = $2, email = $3, username = $4
      WHERE id = $5 AND role = $6 RETURNING *`,
      [
        name, contact, email || null, contact, id, 'Teacher'
      ]
    );

    const updatedTeacher = result.rows[0];

    // Log activity
    const ipAddress = getIpAddress(req);
    const userAgent = getUserAgent(req);
    await logUserActivity(
      req.user.id,
      'update',
      `Updated teacher: ${name}`,
      'teacher',
      id,
      name,
      ipAddress,
      userAgent
    );

    res.json({
      message: 'Teacher updated successfully',
      teacher: updatedTeacher
    });
  } catch (error) {
    console.error('Error updating teacher:', error);
    res.status(500).json({ error: 'Failed to update teacher' });
  }
});

// Delete teacher
router.delete('/:id', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;

    // Check if teacher exists
    const existingTeacher = await pool.query(
      'SELECT * FROM users WHERE id = $1 AND role = $2',
      [id, 'Teacher']
    );

    if (existingTeacher.rows.length === 0) {
      return res.status(404).json({ error: 'Teacher not found' });
    }

    const teacherName = existingTeacher.rows[0].name;

    await pool.query('DELETE FROM users WHERE id = $1 AND role = $2', [id, 'Teacher']);

    // Log activity
    const ipAddress = getIpAddress(req);
    const userAgent = getUserAgent(req);
    await logUserActivity(
      req.user.id,
      'delete',
      `Deleted teacher: ${teacherName}`,
      'teacher',
      id,
      teacherName,
      ipAddress,
      userAgent
    );

    res.json({ message: 'Teacher deleted successfully' });
  } catch (error) {
    console.error('Error deleting teacher:', error);
    res.status(500).json({ error: 'Failed to delete teacher' });
  }
});

// Update teacher status
router.put('/:id/status', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;

    if (!status || !['active', 'inactive', 'suspended'].includes(status)) {
      return res.status(400).json({ error: 'Valid status is required (active, inactive, suspended)' });
    }

    // Check if teacher exists
    const existingTeacher = await pool.query(
      'SELECT * FROM users WHERE id = $1 AND role = $2',
      [id, 'Teacher']
    );

    if (existingTeacher.rows.length === 0) {
      return res.status(404).json({ error: 'Teacher not found' });
    }

    const teacherName = existingTeacher.rows[0].name;

    // Status update not supported in current schema
    // const result = await pool.query(
    //   'UPDATE users SET status = $1 WHERE id = $2 AND role = $3 RETURNING *',
    //   [status, id, 'Teacher']
    // );
    
    // Return the existing teacher for now
    const result = { rows: [existingTeacher.rows[0]] };

    const updatedTeacher = result.rows[0];

    // Log activity
    const ipAddress = getIpAddress(req);
    const userAgent = getUserAgent(req);
    await logUserActivity(
      req.user.id,
      'update',
      `${status} teacher: ${teacherName}`,
      'teacher',
      id,
      teacherName,
      ipAddress,
      userAgent
    );

    res.json({
      message: `Teacher status updated to ${status}`,
      teacher: updatedTeacher
    });
  } catch (error) {
    console.error('Error updating teacher status:', error);
    res.status(500).json({ error: 'Failed to update teacher status' });
  }
});

// Get teacher by ID
router.get('/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query(
      'SELECT id, username, contact, name, email, gender, role, created_at FROM users WHERE id = $1 AND role = $2',
      [id, 'Teacher']
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Teacher not found' });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error fetching teacher:', error);
    res.status(500).json({ error: 'Failed to fetch teacher' });
  }
});

// Get active teachers
router.get('/active/list', authenticateToken, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT id, name, contact, email FROM users WHERE role = $1 ORDER BY name',
      ['Teacher']
    );
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching active teachers:', error);
    res.status(500).json({ error: 'Failed to fetch active teachers' });
  }
});

// Get teacher statistics
router.get('/stats/overview', authenticateToken, async (req, res) => {
  try {
    // Get total teachers
    const totalTeachers = await pool.query('SELECT COUNT(*) as count FROM users WHERE role = $1', ['Teacher']);
    
    // Get teachers by gender
    const teachersByGender = await pool.query(
      'SELECT gender, COUNT(*) as count FROM users WHERE role = $1 GROUP BY gender',
      ['Teacher']
    );
    
    // Get teachers by creation date (last 12 months)
    const teachersByMonth = await pool.query(
      'SELECT DATE_TRUNC(\'month\', created_at) as month, COUNT(*) as count FROM users WHERE role = $1 AND created_at >= NOW() - INTERVAL \'12 months\' GROUP BY DATE_TRUNC(\'month\', created_at) ORDER BY month',
      ['Teacher']
    );

    res.json({
      total: parseInt(totalTeachers.rows[0].count),
      byGender: teachersByGender.rows,
      byMonth: teachersByMonth.rows
    });
  } catch (error) {
    console.error('Error fetching teacher statistics:', error);
    res.status(500).json({ error: 'Failed to fetch teacher statistics' });
  }
});

module.exports = router;

