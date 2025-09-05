const express = require('express');
const { pool, authenticateToken, logUserActivity, getIpAddress, getUserAgent, requireAdmin } = require('./utils');

const router = express.Router();

// Get all inventory items
router.get('/', authenticateToken, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT 
        i.*,
        bh.name as budget_head_name,
        bh.category as budget_head_category
      FROM inventory i
      LEFT JOIN budget_heads bh ON i.budget_head_id = bh.id
      ORDER BY i.created_at DESC
    `);
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
      budget_head_id,
      asset_category,
      purchase_date,
      supplier,
      warranty_expiry,
      location,
      condition,
      depreciation_rate
    } = req.body;

    if (!date || !item_name || !department || !quantity || !estimated_cost || !type) {
      return res.status(400).json({ 
        error: 'Date, item name, department, quantity, estimated cost, and type are required' 
      });
    }

    if (!['income', 'expenditure'].includes(type)) {
      return res.status(400).json({ error: 'Type must be either "income" or "expenditure"' });
    }

    const result = await pool.query(
      `INSERT INTO inventory (
        date, item_name, department, quantity, estimated_cost, type, 
        budget_head_id, asset_category, purchase_date, supplier, 
        warranty_expiry, location, condition, depreciation_rate
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14) RETURNING *`,
      [
        date,
        item_name,
        department,
        parseInt(quantity),
        parseFloat(estimated_cost),
        type,
        budget_head_id || null,
        asset_category || null,
        purchase_date || null,
        supplier || null,
        warranty_expiry || null,
        location || null,
        condition || 'new',
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
      budget_head_id,
      asset_category,
      purchase_date,
      supplier,
      warranty_expiry,
      location,
      condition,
      depreciation_rate
    } = req.body;

    if (!date || !item_name || !department || !quantity || !estimated_cost || !type) {
      return res.status(400).json({ 
        error: 'Date, item name, department, quantity, estimated cost, and type are required' 
      });
    }

    if (!['income', 'expenditure'].includes(type)) {
      return res.status(400).json({ error: 'Type must be either "income" or "expenditure"' });
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
        estimated_cost = $5, type = $6, budget_head_id = $7, asset_category = $8,
        purchase_date = $9, supplier = $10, warranty_expiry = $11, 
        location = $12, condition = $13, depreciation_rate = $14, updated_at = CURRENT_TIMESTAMP
      WHERE id = $15 RETURNING *`,
      [
        date,
        item_name,
        department,
        parseInt(quantity),
        parseFloat(estimated_cost),
        type,
        budget_head_id || null,
        asset_category || null,
        purchase_date || null,
        supplier || null,
        warranty_expiry || null,
        location || null,
        condition || 'new',
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

// Get balance sheet
router.get('/balance-sheet', authenticateToken, async (req, res) => {
  try {
    const { as_of_date } = req.query;
    const dateFilter = as_of_date ? `AND date <= '${as_of_date}'` : '';

    // Get assets (income items with asset categories)
    const assetsResult = await pool.query(`
      SELECT 
        COALESCE(SUM(estimated_cost * quantity), 0) as total_assets,
        COALESCE(SUM(
          CASE 
            WHEN depreciation_rate > 0 AND purchase_date IS NOT NULL THEN 
              estimated_cost * quantity * (1 - (depreciation_rate / 100) * (CURRENT_DATE - purchase_date) / 365.0)
            ELSE estimated_cost * quantity 
          END
        ), 0) as current_value,
        COALESCE(SUM(
          CASE 
            WHEN depreciation_rate > 0 AND purchase_date IS NOT NULL THEN 
              estimated_cost * quantity * (depreciation_rate / 100) * (CURRENT_DATE - purchase_date) / 365.0
            ELSE 0 
          END
        ), 0) as depreciation
      FROM inventory 
      WHERE type = 'income' AND asset_category IS NOT NULL ${dateFilter}
    `);

    // Get liabilities (expenditure items)
    const liabilitiesResult = await pool.query(`
      SELECT 
        COALESCE(SUM(estimated_cost * quantity), 0) as total_liabilities
      FROM inventory 
      WHERE type = 'expenditure' ${dateFilter}
    `);

    // Get equity (net income)
    const equityResult = await pool.query(`
      SELECT 
        COALESCE(SUM(CASE WHEN type = 'income' THEN estimated_cost * quantity ELSE 0 END), 0) as total_income,
        COALESCE(SUM(CASE WHEN type = 'expenditure' THEN estimated_cost * quantity ELSE 0 END), 0) as total_expenditures,
        COALESCE(SUM(CASE WHEN type = 'income' THEN estimated_cost * quantity ELSE -estimated_cost * quantity END), 0) as net_equity
      FROM inventory 
      WHERE 1=1 ${dateFilter}
    `);

    const assets = assetsResult.rows[0];
    const liabilities = liabilitiesResult.rows[0];
    const equity = equityResult.rows[0];

    const balanceSheet = {
      as_of_date: as_of_date || new Date().toISOString().split('T')[0],
      assets,
      liabilities,
      equity,
      totals: {
        total_assets: parseFloat(assets.total_assets),
        total_liabilities: parseFloat(liabilities.total_liabilities),
        total_equity: parseFloat(equity.net_equity),
        assets_plus_equity: parseFloat(assets.current_value) + parseFloat(equity.net_equity),
        liabilities_plus_equity: parseFloat(liabilities.total_liabilities) + parseFloat(equity.net_equity)
      }
    };

    res.json(balanceSheet);
  } catch (error) {
    console.error('Error fetching balance sheet:', error);
    res.status(500).json({ error: 'Failed to fetch balance sheet' });
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

// Get financial summary
router.get('/financial-summary', authenticateToken, async (req, res) => {
  try {
    const { period, month, year } = req.query;
    
    let dateFilter = '';
    let periodValue = '';
    
    if (period === 'month' && month && year) {
      dateFilter = `AND EXTRACT(MONTH FROM date) = ${parseInt(month)} AND EXTRACT(YEAR FROM date) = ${parseInt(year)}`;
      periodValue = `${new Date(parseInt(year), parseInt(month) - 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}`;
    } else if (period === 'year' && year) {
      dateFilter = `AND EXTRACT(YEAR FROM date) = ${parseInt(year)}`;
      periodValue = `Year ${year}`;
    } else {
      // Default to current month
      const now = new Date();
      dateFilter = `AND EXTRACT(MONTH FROM date) = ${now.getMonth() + 1} AND EXTRACT(YEAR FROM date) = ${now.getFullYear()}`;
      periodValue = `${now.toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}`;
    }

    const result = await pool.query(`
      SELECT 
        COALESCE(SUM(CASE WHEN type = 'income' THEN estimated_cost * quantity ELSE 0 END), 0) as income,
        COALESCE(SUM(CASE WHEN type = 'expenditure' THEN estimated_cost * quantity ELSE 0 END), 0) as expenditure,
        COALESCE(SUM(CASE WHEN type = 'income' AND asset_category IS NOT NULL THEN estimated_cost * quantity ELSE 0 END), 0) as asset_purchase,
        COALESCE(SUM(CASE WHEN type = 'income' THEN estimated_cost * quantity ELSE -estimated_cost * quantity END), 0) as net_balance
      FROM inventory 
      WHERE 1=1 ${dateFilter}
    `);

    const summary = result.rows[0];
    res.json({
      ...summary,
      period_value: periodValue,
      period: period || 'month'
    });
  } catch (error) {
    console.error('Error fetching financial summary:', error);
    res.status(500).json({ error: 'Failed to fetch financial summary' });
  }
});

// Calculate depreciation
router.post('/calculate-depreciation', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const { month, year } = req.body;
    
    if (!month || !year) {
      return res.status(400).json({ error: 'Month and year are required' });
    }

    // Get all assets with depreciation rates
    const assetsResult = await pool.query(`
      SELECT id, item_name, estimated_cost, quantity, depreciation_rate, purchase_date
      FROM inventory 
      WHERE type = 'income' AND asset_category IS NOT NULL AND depreciation_rate > 0 AND purchase_date IS NOT NULL
    `);

    let recordsProcessed = 0;
    
    for (const asset of assetsResult.rows) {
      if (asset.purchase_date) {
        const purchaseDate = new Date(asset.purchase_date);
        const currentDate = new Date(parseInt(year), parseInt(month) - 1, 1);
        
        // Calculate months since purchase
        const monthsDiff = (currentDate.getFullYear() - purchaseDate.getFullYear()) * 12 + 
                          (currentDate.getMonth() - purchaseDate.getMonth());
        
        if (monthsDiff > 0) {
          const monthlyDepreciation = (asset.estimated_cost * asset.quantity * asset.depreciation_rate / 100) / 12;
          const totalDepreciation = monthlyDepreciation * monthsDiff;
          
          // Update the asset with accumulated depreciation
          await pool.query(`
            UPDATE inventory 
            SET accumulated_depreciation = $1, 
                current_value = $2,
                updated_at = CURRENT_TIMESTAMP
            WHERE id = $3
          `, [
            totalDepreciation,
            (asset.estimated_cost * asset.quantity) - totalDepreciation,
            asset.id
          ]);
          
          recordsProcessed++;
        }
      }
    }

    res.json({
      message: 'Depreciation calculated successfully',
      records_processed: recordsProcessed,
      month: parseInt(month),
      year: parseInt(year)
    });
  } catch (error) {
    console.error('Error calculating depreciation:', error);
    res.status(500).json({ error: 'Failed to calculate depreciation' });
  }
});

module.exports = router;

