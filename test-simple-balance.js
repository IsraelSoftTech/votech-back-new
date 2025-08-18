const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL
});

async function testSimpleBalance() {
  try {
    console.log('Testing simple balance sheet queries...');
    const client = await pool.connect();
    
    // Test 1: Simple inventory query
    console.log('\n1. Testing inventory query...');
    try {
      const inventoryResult = await client.query('SELECT COUNT(*) as count FROM inventory');
      console.log('Inventory count:', inventoryResult.rows[0].count);
    } catch (error) {
      console.error('Inventory query error:', error.message);
    }
    
    // Test 2: Simple financial_transactions query
    console.log('\n2. Testing financial_transactions query...');
    try {
      const transactionsResult = await client.query('SELECT COUNT(*) as count FROM financial_transactions');
      console.log('Financial transactions count:', transactionsResult.rows[0].count);
    } catch (error) {
      console.error('Financial transactions query error:', error.message);
    }
    
    // Test 3: Test the exact assets query from balance sheet
    console.log('\n3. Testing assets query...');
    try {
      const assetsQuery = `
        SELECT 
          SUM(estimated_cost) as total_assets,
          SUM(estimated_cost) as current_value
        FROM inventory 
        WHERE type = 'expenditure' AND estimated_cost > 0
      `;
      const assetsResult = await client.query(assetsQuery);
      console.log('Assets result:', assetsResult.rows[0]);
    } catch (error) {
      console.error('Assets query error:', error.message);
    }
    
    // Test 4: Test the exact liabilities query from balance sheet
    console.log('\n4. Testing liabilities query...');
    try {
      const liabilitiesQuery = `
        SELECT SUM(amount) as total_liabilities
        FROM financial_transactions 
        WHERE type = 'expenditure' AND transaction_date <= $1
      `;
      const liabilitiesResult = await client.query(liabilitiesQuery, ['2025-08-17']);
      console.log('Liabilities result:', liabilitiesResult.rows[0]);
    } catch (error) {
      console.error('Liabilities query error:', error.message);
    }
    
    // Test 5: Test the exact equity query from balance sheet
    console.log('\n5. Testing equity query...');
    try {
      const equityQuery = `
        SELECT 
          SUM(CASE WHEN type = 'income' THEN amount ELSE 0 END) as total_income,
          SUM(CASE WHEN type = 'expenditure' THEN amount ELSE 0 END) as total_expenditures
        FROM financial_transactions 
        WHERE transaction_date <= $1
      `;
      const equityResult = await client.query(equityQuery, ['2025-08-17']);
      console.log('Equity result:', equityResult.rows[0]);
    } catch (error) {
      console.error('Equity query error:', error.message);
    }
    
    client.release();
    await pool.end();
    
  } catch (error) {
    console.error('Test failed:', error.message);
    await pool.end();
  }
}

testSimpleBalance(); 