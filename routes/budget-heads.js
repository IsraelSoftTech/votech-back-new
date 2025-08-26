const express = require('express');
const { pool, authenticateToken } = require('./utils');

const router = express.Router();

// Get all budget heads
router.get('/', authenticateToken, async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM budget_heads ORDER BY name');
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching budget heads:', error);
    res.status(500).json({ error: 'Failed to fetch budget heads' });
  }
});

// Create new budget head
router.post('/', authenticateToken, async (req, res) => {
  try {
    const { name, description, type, amount, fiscal_year } = req.body;
    const result = await pool.query(
      'INSERT INTO budget_heads (name, description, type, amount, fiscal_year) VALUES ($1, $2, $3, $4, $5) RETURNING *',
      [name, description, type, amount, fiscal_year]
    );
    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('Error creating budget head:', error);
    res.status(500).json({ error: 'Failed to create budget head' });
  }
});

// Update budget head
router.put('/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { name, description, type, amount, fiscal_year } = req.body;
    const result = await pool.query(
      'UPDATE budget_heads SET name = $1, description = $2, type = $3, amount = $4, fiscal_year = $5 WHERE id = $6 RETURNING *',
      [name, description, type, amount, fiscal_year, id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Budget head not found' });
    }
    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error updating budget head:', error);
    res.status(500).json({ error: 'Failed to update budget head' });
  }
});

// Delete budget head
router.delete('/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query('DELETE FROM budget_heads WHERE id = $1 RETURNING *', [id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Budget head not found' });
    }
    res.json({ message: 'Budget head deleted successfully' });
  } catch (error) {
    console.error('Error deleting budget head:', error);
    res.status(500).json({ error: 'Failed to delete budget head' });
  }
});

module.exports = router;
