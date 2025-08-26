const express = require('express');
const { pool, authenticateToken } = require('./utils');

const router = express.Router();

// Get all asset categories
router.get('/', authenticateToken, async (req, res) => {
  try {
    const result = await pool.query('SELECT * FROM asset_categories ORDER BY name');
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching asset categories:', error);
    res.status(500).json({ error: 'Failed to fetch asset categories' });
  }
});

// Create new asset category
router.post('/', authenticateToken, async (req, res) => {
  try {
    const { name, description, depreciation_rate, useful_life } = req.body;
    const result = await pool.query(
      'INSERT INTO asset_categories (name, description, depreciation_rate, useful_life) VALUES ($1, $2, $3, $4) RETURNING *',
      [name, description, depreciation_rate, useful_life]
    );
    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error('Error creating asset category:', error);
    res.status(500).json({ error: 'Failed to create asset category' });
  }
});

// Update asset category
router.put('/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { name, description, depreciation_rate, useful_life } = req.body;
    const result = await pool.query(
      'UPDATE asset_categories SET name = $1, description = $2, depreciation_rate = $3, useful_life = $4 WHERE id = $5 RETURNING *',
      [name, description, depreciation_rate, useful_life, id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Asset category not found' });
    }
    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error updating asset category:', error);
    res.status(500).json({ error: 'Failed to update asset category' });
  }
});

// Delete asset category
router.delete('/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query('DELETE FROM asset_categories WHERE id = $1 RETURNING *', [id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Asset category not found' });
    }
    res.json({ message: 'Asset category deleted successfully' });
  } catch (error) {
    console.error('Error deleting asset category:', error);
    res.status(500).json({ error: 'Failed to delete asset category' });
  }
});

module.exports = router;
