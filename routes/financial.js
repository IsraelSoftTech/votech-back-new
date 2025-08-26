const express = require('express');
const { pool, authenticateToken } = require('./utils');

const router = express.Router();

// Get financial summary
router.get('/summary', authenticateToken, async (req, res) => {
  try {
    const { start_date, end_date, type } = req.query;
    let query = `
      SELECT 
        COALESCE(SUM(CASE WHEN type = 'income' THEN amount ELSE 0 END), 0) as total_income,
        COALESCE(SUM(CASE WHEN type = 'expense' THEN amount ELSE 0 END), 0) as total_expenses,
        COALESCE(SUM(CASE WHEN type = 'income' THEN amount ELSE -amount END), 0) as net_income
      FROM financial_transactions
      WHERE 1=1
    `;
    
    const params = [];
    let paramCount = 0;
    
    if (start_date) {
      paramCount++;
      query += ` AND transaction_date >= $${paramCount}`;
      params.push(start_date);
    }
    
    if (end_date) {
      paramCount++;
      query += ` AND transaction_date <= $${paramCount}`;
      params.push(end_date);
    }
    
    if (type) {
      paramCount++;
      query += ` AND type = $${paramCount}`;
      params.push(type);
    }
    
    const result = await pool.query(query, params);
    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error fetching financial summary:', error);
    res.status(500).json({ error: 'Failed to fetch financial summary' });
  }
});

// Get balance sheet
router.get('/balance-sheet', authenticateToken, async (req, res) => {
  try {
    const { as_of_date } = req.query;
    
    // Get assets
    const assetsResult = await pool.query(`
      SELECT 
        'assets' as category,
        COALESCE(SUM(book_value), 0) as total
      FROM inventory 
      WHERE type = 'asset' AND status = 'active'
    `);
    
    // Get liabilities
    const liabilitiesResult = await pool.query(`
      SELECT 
        'liabilities' as category,
        COALESCE(SUM(amount), 0) as total
      FROM financial_transactions 
      WHERE type = 'liability' AND status = 'outstanding'
    `);
    
    // Get equity
    const equityResult = await pool.query(`
      SELECT 
        'equity' as category,
        COALESCE(SUM(CASE WHEN type = 'income' THEN amount ELSE -amount END), 0) as total
      FROM financial_transactions
    `);
    
    const balanceSheet = {
      assets: assetsResult.rows[0]?.total || 0,
      liabilities: liabilitiesResult.rows[0]?.total || 0,
      equity: equityResult.rows[0]?.total || 0,
      total_liabilities_equity: (liabilitiesResult.rows[0]?.total || 0) + (equityResult.rows[0]?.total || 0)
    };
    
    res.json(balanceSheet);
  } catch (error) {
    console.error('Error fetching balance sheet:', error);
    res.status(500).json({ error: 'Failed to fetch balance sheet' });
  }
});

// Calculate depreciation
router.post('/calculate-depreciation', authenticateToken, async (req, res) => {
  try {
    const { asset_id, depreciation_amount, depreciation_date } = req.body;
    
    // Update asset book value
    await pool.query(`
      UPDATE inventory 
      SET book_value = book_value - $1, 
          accumulated_depreciation = accumulated_depreciation + $1
      WHERE id = $2
    `, [depreciation_amount, asset_id]);
    
    // Record depreciation transaction
    const result = await pool.query(`
      INSERT INTO financial_transactions 
      (type, amount, description, transaction_date, related_asset_id) 
      VALUES ('depreciation', $1, 'Depreciation expense', $2, $3) 
      RETURNING *
    `, [depreciation_amount, depreciation_date, asset_id]);
    
    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error calculating depreciation:', error);
    res.status(500).json({ error: 'Failed to calculate depreciation' });
  }
});

module.exports = router;
