const express = require('express');
const { pool, authenticateToken, logUserActivity, getIpAddress, getUserAgent, requireAdmin } = require('./utils');

const router = express.Router();

// Get all inventory items
router.get('/', authenticateToken, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT * FROM inventory ORDER BY created_at DESC'
    );
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching inventory:', error);
    res.status(500).json({ error: 'Failed to fetch inventory' });
  }
});

// Create inventory item
router.post('/', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const {
      date,
      item_name,
      department,
      quantity,
      estimated_cost,
      type,
      depreciation_rate
    } = req.body;

    if (!date || !item_name || !department || !quantity || !estimated_cost || !type) {
      return res.status(400).json({ 
        error: 'Date, item name, department, quantity, estimated cost, and type are required' 
      });
    }

    if (!['asset', 'consumable'].includes(type)) {
      return res.status(400).json({ error: 'Type must be either "asset" or "consumable"' });
    }

    const result = await pool.query(
      `INSERT INTO inventory (
        date, item_name, department, quantity, estimated_cost, type, depreciation_rate
      ) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [
        date,
        item_name,
        department,
        parseInt(quantity),
        parseFloat(estimated_cost),
        type,
        depreciation_rate ? parseFloat(depreciation_rate) : null
      ]
    );

    const newItem = result.rows[0];

    // Log activity
    const ipAddress = getIpAddress(req);
    const userAgent = getUserAgent(req);
    await logUserActivity(
      req.user.id,
      'create',
      `Added inventory item: ${item_name}`,
      'inventory',
      newItem.id,
      item_name,
      ipAddress,
      userAgent
    );

    res.status(201).json({
      message: 'Inventory item created successfully',
      item: newItem
    });
  } catch (error) {
    console.error('Error creating inventory item:', error);
    res.status(500).json({ error: 'Failed to create inventory item' });
  }
});

// Update inventory item
router.put('/:id', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;
    const {
      date,
      item_name,
      department,
      quantity,
      estimated_cost,
      type,
      depreciation_rate
    } = req.body;

    if (!date || !item_name || !department || !quantity || !estimated_cost || !type) {
      return res.status(400).json({ 
        error: 'Date, item name, department, quantity, estimated cost, and type are required' 
      });
    }

    if (!['asset', 'consumable'].includes(type)) {
      return res.status(400).json({ error: 'Type must be either "asset" or "consumable"' });
    }

    // Check if item exists
    const existingItem = await pool.query(
      'SELECT * FROM inventory WHERE id = $1',
      [id]
    );

    if (existingItem.rows.length === 0) {
      return res.status(404).json({ error: 'Inventory item not found' });
    }

    const result = await pool.query(
      `UPDATE inventory SET 
        date = $1, item_name = $2, department = $3, quantity = $4, 
        estimated_cost = $5, type = $6, depreciation_rate = $7, updated_at = CURRENT_TIMESTAMP
      WHERE id = $8 RETURNING *`,
      [
        date,
        item_name,
        department,
        parseInt(quantity),
        parseFloat(estimated_cost),
        type,
        depreciation_rate ? parseFloat(depreciation_rate) : null,
        id
      ]
    );

    const updatedItem = result.rows[0];

    // Log activity
    const ipAddress = getIpAddress(req);
    const userAgent = getUserAgent(req);
    await logUserActivity(
      req.user.id,
      'update',
      `Updated inventory item: ${item_name}`,
      'inventory',
      id,
      item_name,
      ipAddress,
      userAgent
    );

    res.json({
      message: 'Inventory item updated successfully',
      item: updatedItem
    });
  } catch (error) {
    console.error('Error updating inventory item:', error);
    res.status(500).json({ error: 'Failed to update inventory item' });
  }
});

// Delete inventory item
router.delete('/:id', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { id } = req.params;

    // Check if item exists
    const existingItem = await pool.query(
      'SELECT * FROM inventory WHERE id = $1',
      [id]
    );

    if (existingItem.rows.length === 0) {
      return res.status(404).json({ error: 'Inventory item not found' });
    }

    const itemName = existingItem.rows[0].item_name;

    await pool.query('DELETE FROM inventory WHERE id = $1', [id]);

    // Log activity
    const ipAddress = getIpAddress(req);
    const userAgent = getUserAgent(req);
    await logUserActivity(
      req.user.id,
      'delete',
      `Deleted inventory item: ${itemName}`,
      'inventory',
      id,
      itemName,
      ipAddress,
      userAgent
    );

    res.json({ message: 'Inventory item deleted successfully' });
  } catch (error) {
    console.error('Error deleting inventory item:', error);
    res.status(500).json({ error: 'Failed to delete inventory item' });
  }
});

// Get inventory item by ID
router.get('/:id', authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query(
      'SELECT * FROM inventory WHERE id = $1',
      [id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Inventory item not found' });
    }

    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error fetching inventory item:', error);
    res.status(500).json({ error: 'Failed to fetch inventory item' });
  }
});

// Get inventory statistics
router.get('/stats/overview', authenticateToken, async (req, res) => {
  try {
    // Get total items
    const totalItems = await pool.query('SELECT COUNT(*) as count FROM inventory');
    
    // Get items by type
    const itemsByType = await pool.query(
      'SELECT type, COUNT(*) as count, SUM(estimated_cost) as total_value FROM inventory GROUP BY type'
    );
    
    // Get items by department
    const itemsByDepartment = await pool.query(
      'SELECT department, COUNT(*) as count, SUM(estimated_cost) as total_value FROM inventory GROUP BY department'
    );

    // Get total estimated value
    const totalValue = await pool.query(
      'SELECT SUM(estimated_cost) as total FROM inventory'
    );

    res.json({
      total: parseInt(totalItems.rows[0].count),
      byType: itemsByType.rows,
      byDepartment: itemsByDepartment.rows,
      totalValue: parseFloat(totalValue.rows[0].total || 0)
    });
  } catch (error) {
    console.error('Error fetching inventory statistics:', error);
    res.status(500).json({ error: 'Failed to fetch inventory statistics' });
  }
});

// Search inventory items
router.get('/search/items', authenticateToken, async (req, res) => {
  try {
    const { query, department, type } = req.query;
    
    let sql = 'SELECT * FROM inventory WHERE 1=1';
    const params = [];
    let paramCount = 0;

    if (query) {
      paramCount++;
      sql += ` AND (item_name ILIKE $${paramCount} OR department ILIKE $${paramCount})`;
      params.push(`%${query}%`);
    }

    if (department) {
      paramCount++;
      sql += ` AND department = $${paramCount}`;
      params.push(department);
    }

    if (type) {
      paramCount++;
      sql += ` AND type = $${paramCount}`;
      params.push(type);
    }

    sql += ' ORDER BY created_at DESC';

    const result = await pool.query(sql, params);
    res.json(result.rows);
  } catch (error) {
    console.error('Error searching inventory:', error);
    res.status(500).json({ error: 'Failed to search inventory' });
  }
});

// Get departments
router.get('/departments/list', authenticateToken, async (req, res) => {
  try {
    const result = await pool.query(
      'SELECT DISTINCT department FROM inventory WHERE department IS NOT NULL ORDER BY department'
    );
    res.json(result.rows.map(row => row.department));
  } catch (error) {
    console.error('Error fetching departments:', error);
    res.status(500).json({ error: 'Failed to fetch departments' });
  }
});

module.exports = router;

