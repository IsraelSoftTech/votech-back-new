const express = require('express');
const { pool, authenticateToken, logUserActivity, getIpAddress, getUserAgent, requireAdmin } = require('./utils');

const router = express.Router();

// Get all classes
router.get('/', authenticateToken, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM classes ORDER BY name'
    );
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching classes:', error);
    res.status(500).json({ error: 'Failed to fetch classes' });
  }
});

// Create class
router.post('/', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const {
      name,
      registration_fee,
      bus_fee,
      internship_fee,
      remedial_fee,
      tuition_fee,
      pta_fee,
      description
    } = req.body;

    if (!name) {
      return res.status(400).json({ error: 'Class name is required' });
    }

    // Check if class name already exists
    const existingClass = await pool.query(
      'SELECT * FROM classes WHERE name = $1',
      [name]
    );

    if (existingClass.rows.length > 0) {
      return res.status(400).json({ error: 'Class name already exists' });
    }

    const result = await pool.query(
      `INSERT INTO classes (
        name, registration_fee, bus_fee, internship_fee, 
        remedial_fee, tuition_fee, pta_fee, description
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) 
      RETURNING *`,
      [
        name,
        registration_fee || 0,
        bus_fee || 0,
        internship_fee || 0,
        remedial_fee || 0,
        tuition_fee || 0,
        pta_fee || 0,
        description || null
      ]
    );

    const newClass = result.rows[0];

    // Log activity
    const ipAddress = getIpAddress(req);
    const userAgent = getUserAgent(req);
    await logUserActivity(
      req.user.id,
      'create',
      `Created class: ${name}`,
      'class',
      newClass.id,
      name,
      ipAddress,
      userAgent
    );

    res.status(201).json({
      message: 'Class created successfully',
      class: newClass
    });
  } catch (error) {
    console.error('Error creating class:', error);
    res.status(500).json({ error: 'Failed to create class' });
  }
});

// Update class
router.put('/:id', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const {
      name,
      registration_fee,
      bus_fee,
      internship_fee,
      remedial_fee,
      tuition_fee,
      pta_fee,
      description
    } = req.body;

    if (!name) {
      return res.status(400).json({ error: 'Class name is required' });
    }

    // Check if class exists
    const existingClass = await pool.query(
      'SELECT * FROM classes WHERE id = $1',
      [id]
    );

    if (existingClass.rows.length === 0) {
      return res.status(404).json({ error: 'Class not found' });
    }

    // Check if new name conflicts with existing class
    const nameConflict = await pool.query(
      'SELECT * FROM classes WHERE name = $1 AND id != $2',
      [name, id]
    );

    if (nameConflict.rows.length > 0) {
      return res.status(400).json({ error: 'Class name already exists' });
    }

    const result = await pool.query(
      `UPDATE classes SET 
        name = $1, registration_fee = $2, bus_fee = $3, internship_fee = $4,
        remedial_fee = $5, tuition_fee = $6, pta_fee = $7, description = $8
      WHERE id = $9 RETURNING *`,
      [
        name,
        registration_fee || 0,
        bus_fee || 0,
        internship_fee || 0,
        remedial_fee || 0,
        tuition_fee || 0,
        pta_fee || 0,
        description || null,
        id
      ]
    );

    const updatedClass = result.rows[0];

    // Log activity
    const ipAddress = getIpAddress(req);
    const userAgent = getUserAgent(req);
    await logUserActivity(
      req.user.id,
      'update',
      `Updated class: ${name}`,
      'class',
      id,
      name,
      ipAddress,
      userAgent
    );

    res.json({
      message: 'Class updated successfully',
      class: updatedClass
    });
  } catch (error) {
    console.error('Error updating class:', error);
    res.status(500).json({ error: 'Failed to update class' });
  }
});

// Delete class
router.delete('/:id', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;

    // Check if class exists
    const existingClass = await pool.query(
      'SELECT * FROM classes WHERE id = $1',
      [id]
    );

    if (existingClass.rows.length === 0) {
      return res.status(404).json({ error: 'Class not found' });
    }

    const className = existingClass.rows[0].name;

    // Check if class has students
    const studentsInClass = await pool.query(
      'SELECT COUNT(*) as count FROM students WHERE class_id = $1',
      [id]
    );

    if (parseInt(studentsInClass.rows[0].count) > 0) {
      return res.status(400).json({ 
        error: 'Cannot delete class with students. Please reassign or remove students first.' 
      });
    }

    await pool.query('DELETE FROM classes WHERE id = $1', [id]);

    // Log activity
    const ipAddress = getIpAddress(req);
    const userAgent = getUserAgent(req);
    await logUserActivity(
      req.user.id,
      'delete',
      `Deleted class: ${className}`,
      'class',
      id,
      className,
      ipAddress,
      userAgent
    );

    res.json({ message: 'Class deleted successfully' });
  } catch (error) {
    console.error('Error deleting class:', error);
    res.status(500).json({ error: 'Failed to delete class' });
  }
});

// Get class by ID
router.get('/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query(
      'SELECT * FROM classes WHERE id = $1',
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Class not found' });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error fetching class:', error);
    res.status(500).json({ error: 'Failed to fetch class' });
  }
});

// Get students in class
router.get('/:id/students', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query(
      `SELECT s.*, c.name as class_name 
       FROM students s 
       LEFT JOIN classes c ON s.class_id = c.id 
       WHERE s.class_id = $1 
       ORDER BY s.full_name`,
      [id]
    );

    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching class students:', error);
    res.status(500).json({ error: 'Failed to fetch class students' });
  }
});

// Get class statistics
router.get('/:id/stats', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    
    // Get student count
    const studentCount = await pool.query(
      'SELECT COUNT(*) as count FROM students WHERE class_id = $1',
      [id]
    );

    // Get fee statistics
    const feeStats = await pool.query(
      `SELECT 
        fee_type,
        COUNT(*) as payment_count,
        SUM(amount) as total_amount
       FROM fees f
       JOIN students s ON f.student_id = s.id
       WHERE s.class_id = $1
       GROUP BY fee_type`,
      [id]
    );

    // Get class details
    const classDetails = await pool.query(
      'SELECT * FROM classes WHERE id = $1',
      [id]
    );

    res.json({
      class: classDetails.rows[0],
      studentCount: parseInt(studentCount.rows[0].count),
      feeStats: feeStats.rows
    });
  } catch (error) {
    console.error('Error fetching class statistics:', error);
    res.status(500).json({ error: 'Failed to fetch class statistics' });
  }
});

module.exports = router;

