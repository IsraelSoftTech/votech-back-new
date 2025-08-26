const express = require('express');
const { pool, authenticateToken } = require('./utils');

const router = express.Router();

// Get all departments
router.get('/', authenticateToken, async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM departments ORDER BY name');
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching departments:', error);
    res.status(500).json({ error: 'Failed to fetch departments' });
  }
});

// Create new department
router.post('/', authenticateToken, async (req, res) => {
  try {
    const { name, description, head_teacher_id, budget } = req.body;
    const result = await pool.query(
      'INSERT INTO departments (name, description, head_teacher_id, budget) VALUES ($1, $2, $3, $4) RETURNING *',
      [name, description, head_teacher_id, budget]
    );
    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('Error creating department:', error);
    res.status(500).json({ error: 'Failed to create department' });
  }
});

// Update department
router.put('/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { name, description, head_teacher_id, budget } = req.body;
    const result = await pool.query(
      'UPDATE departments SET name = $1, description = $2, head_teacher_id = $3, budget = $4 WHERE id = $5 RETURNING *',
      [name, description, head_teacher_id, budget, id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Department not found' });
    }
    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error updating department:', error);
    res.status(500).json({ error: 'Failed to update department' });
  }
});

// Delete department
router.delete('/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query('DELETE FROM departments WHERE id = $1 RETURNING *', [id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Department not found' });
    }
    res.json({ message: 'Department deleted successfully' });
  } catch (error) {
    console.error('Error deleting department:', error);
    res.status(500).json({ error: 'Failed to delete department' });
  }
});

module.exports = router;
