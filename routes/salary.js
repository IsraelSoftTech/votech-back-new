const express = require('express');
const router = express.Router();
const { Pool } = require('pg');
require('dotenv').config();

// Create pool directly in this file
const pool = new Pool({
  connectionString: process.env.DATABASE_URL
});

// Helper function to convert month number to month name
const getMonthName = (monthNumber) => {
  const months = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'
  ];
  return months[monthNumber - 1];
};

// Helper function to convert month name to month number
const getMonthNumber = (monthName) => {
  const months = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'
  ];
  return months.indexOf(monthName) + 1;
};

// Get all approved applications with salary information
router.get('/approved-applications', async (req, res) => {
  try {
    const currentMonth = new Date().getMonth() + 1; // 1-12
    const currentMonthName = getMonthName(currentMonth);
    
    // Calculate academic year start (changes on August 1st)
    const now = new Date();
    const currentYear = now.getFullYear();
    const currentMonthNum = now.getMonth() + 1; // 1-12
    const currentDay = now.getDate();
    
    // Academic year changes on August 1st
    // If we're in August (1st or later) or September onwards, use current year as start
    let academicYearStart;
    if (currentMonthNum >= 8) {
      academicYearStart = currentYear;
    } else {
      academicYearStart = currentYear - 1;
    }

    const result = await pool.query(`
      SELECT 
        a.id as application_id,
        a.applicant_id,
        a.applicant_name,
        a.contact,
        a.classes,
        a.subjects,
        a.status,
        COALESCE(s.amount, 0) as salary_amount,
        s.id as salary_id,
        CASE WHEN s.paid = true THEN 'paid' ELSE 'pending' END as salary_status,
        s.month as salary_month,
        s.year as salary_year,
        s.paid_at,
        (
          SELECT STRING_AGG(
            CONCAT(s2.month, '/', s2.year), 
            ', ' ORDER BY s2.year DESC, s2.month DESC
          )
          FROM salaries s2 
          WHERE s2.user_id = a.applicant_id 
          AND s2.paid = true
        ) as paid_months,
        (
          SELECT COUNT(*)
          FROM salaries s3
          WHERE s3.user_id = a.applicant_id 
          AND s3.amount > 0
        ) as total_salary_records,
        (
          SELECT COUNT(*)
          FROM salaries s4
          WHERE s4.user_id = a.applicant_id 
          AND s4.paid = true
        ) as paid_salary_records,
        (
          SELECT json_agg(
            json_build_object(
              'id', s5.id,
              'month', s5.month,
              'year', s5.year,
              'amount', s5.amount,
              'paid', s5.paid,
              'paid_at', s5.paid_at
            ) ORDER BY s5.month
          )
          FROM salaries s5
          WHERE s5.user_id = a.applicant_id 
          AND s5.year = $2
        ) as all_salary_records
      FROM applications a
      LEFT JOIN salaries s ON a.applicant_id = s.user_id 
        AND s.month = $1
        AND s.year = $2
      WHERE a.status = 'approved'
      ORDER BY a.applicant_name
    `, [currentMonthName, academicYearStart]);

    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching approved applications:', error);
    res.status(500).json({ error: 'Failed to fetch approved applications' });
  }
});

// Get salary statistics for current month
router.get('/statistics', async (req, res) => {
  try {
    const currentMonth = new Date().getMonth() + 1; // 1-12
    const currentMonthName = getMonthName(currentMonth);
    
    // Calculate academic year start (changes on August 1st)
    const now = new Date();
    const currentYear = now.getFullYear();
    const currentMonthNum = now.getMonth() + 1; // 1-12
    const currentDay = now.getDate();
    
    // Academic year changes on August 1st
    // If we're in August (1st or later) or September onwards, use current year as start
    let academicYearStart;
    if (currentMonthNum >= 8) {
      academicYearStart = currentYear;
    } else {
      academicYearStart = currentYear - 1;
    }

    // Get total salary paid for this month
    const paidResult = await pool.query(`
      SELECT COALESCE(SUM(amount), 0) as total_paid
      FROM salaries 
      WHERE month = $1 AND year = $2 AND paid = true
    `, [currentMonthName, academicYearStart]);

    // Get total salary left (pending) for this month
    const pendingResult = await pool.query(`
      SELECT COALESCE(SUM(amount), 0) as total_pending
      FROM salaries 
      WHERE month = $1 AND year = $2 AND (paid = false OR paid IS NULL)
    `, [currentMonthName, academicYearStart]);

    // Get total approved applications count
    const approvedCountResult = await pool.query(`
      SELECT COUNT(*) as total_approved
      FROM applications 
      WHERE status = 'approved'
    `);

    res.json({
      totalPaid: parseFloat(paidResult.rows[0].total_paid),
      totalPending: parseFloat(pendingResult.rows[0].total_pending),
      totalApproved: parseInt(approvedCountResult.rows[0].total_approved)
    });
  } catch (error) {
    console.error('Error fetching salary statistics:', error);
    res.status(500).json({ error: 'Failed to fetch salary statistics' });
  }
});

// Create or update salary for a user
router.post('/update', async (req, res) => {
  try {
    const { userId, amount, month, year } = req.body;

    if (!userId || !amount) {
      return res.status(400).json({ error: 'User ID and amount are required' });
    }

    // Validate amount
    if (amount <= 0) {
      return res.status(400).json({ error: 'Salary amount must be greater than 0' });
    }

    // Check if user exists and has approved application
    const userCheck = await pool.query(`
      SELECT id FROM applications 
      WHERE applicant_id = $1 AND status = 'approved'
    `, [userId]);

    if (userCheck.rows.length === 0) {
      return res.status(404).json({ error: 'User not found or application not approved' });
    }

    // Calculate academic year start (changes on August 1st)
    const now = new Date();
    const currentYear = now.getFullYear();
    const currentMonth = now.getMonth() + 1; // 1-12
    const currentDay = now.getDate();
    
    // Academic year changes on August 1st
    // If we're in August (1st or later) or September onwards, use current year as start
    let academicYearStart;
    if (currentMonth >= 8) {
      academicYearStart = currentYear;
    } else {
      academicYearStart = currentYear - 1;
    }

    // Create or update salary records for all months of the academic year
    const results = [];
    
    for (let monthNum = 1; monthNum <= 12; monthNum++) {
      const monthName = getMonthName(monthNum);
      
      // Check if salary record already exists for this month/year
      const existingSalary = await pool.query(`
        SELECT id FROM salaries 
        WHERE user_id = $1 AND month = $2 AND year = $3
      `, [userId, monthName, academicYearStart]);

      let result;
      if (existingSalary.rows.length > 0) {
        // Update existing salary
        result = await pool.query(`
          UPDATE salaries 
          SET amount = $1, updated_at = CURRENT_TIMESTAMP
          WHERE user_id = $2 AND month = $3 AND year = $4
          RETURNING *
        `, [amount, userId, monthName, academicYearStart]);
      } else {
        // Create new salary record
        result = await pool.query(`
          INSERT INTO salaries (user_id, applicant_id, amount, month, year, paid)
          VALUES ($1, $2, $3, $4, $5, false)
          RETURNING *
        `, [userId, userCheck.rows[0].id, amount, monthName, academicYearStart]);
      }
      
      results.push(result.rows[0]);
    }

    res.json({
      message: 'Salary updated successfully for all months',
      salaries: results
    });
  } catch (error) {
    console.error('Error updating salary:', error);
    res.status(500).json({ error: 'Failed to update salary' });
  }
});

// Mark salary as paid
router.put('/mark-paid/:salaryId', async (req, res) => {
  try {
    const { salaryId } = req.params;

    // First, get the salary record to check if it's already paid
    const salaryCheck = await pool.query(`
      SELECT s.*, a.applicant_name 
      FROM salaries s
      JOIN applications a ON s.applicant_id = a.id
      WHERE s.id = $1
    `, [salaryId]);

    if (salaryCheck.rows.length === 0) {
      return res.status(404).json({ error: 'Salary record not found' });
    }

    const salaryRecord = salaryCheck.rows[0];

    // Check if this specific salary record is already paid
    if (salaryRecord.paid === true) {
      return res.status(400).json({ 
        error: `Salary for ${salaryRecord.applicant_name} for month ${salaryRecord.month}/${salaryRecord.year} has already been paid on ${new Date(salaryRecord.paid_at).toLocaleDateString()}` 
      });
    }

    // Mark salary as paid
    const result = await pool.query(`
      UPDATE salaries 
      SET paid = true, paid_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
      WHERE id = $1
      RETURNING *
    `, [salaryId]);

    res.json({
      message: 'Salary marked as paid successfully',
      salary: result.rows[0]
    });
  } catch (error) {
    console.error('Error marking salary as paid:', error);
    res.status(500).json({ error: 'Failed to mark salary as paid' });
  }
});

// Get salary history for a user
router.get('/user/:userId', async (req, res) => {
  try {
    const { userId } = req.params;

    const result = await pool.query(`
      SELECT 
        s.*,
        a.applicant_name,
        a.contact
      FROM salaries s
      JOIN applications a ON s.applicant_id = a.id
      WHERE s.user_id = $1
      ORDER BY s.year DESC, s.month DESC
    `, [userId]);

    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching user salary history:', error);
    res.status(500).json({ error: 'Failed to fetch salary history' });
  }
});

// Get all paid salary records for pay slips
router.get('/paid-salaries', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT 
        s.id,
        s.amount,
        s.month,
        s.year,
        s.paid_at,
        a.applicant_name,
        a.contact,
        a.classes,
        a.subjects
      FROM salaries s
      JOIN applications a ON s.applicant_id = a.id
      WHERE s.paid = true
      ORDER BY s.paid_at DESC, a.applicant_name ASC
    `);

    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching paid salaries:', error);
    res.status(500).json({ error: 'Failed to fetch paid salaries' });
  }
});

// Get salary descriptions
router.get('/descriptions', async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT id, description, percentage
      FROM salary_descriptions
      ORDER BY id ASC
    `);

    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching salary descriptions:', error);
    res.status(500).json({ error: 'Failed to fetch salary descriptions' });
  }
});

// Save salary descriptions
router.post('/descriptions', async (req, res) => {
  try {
    const { descriptions } = req.body;

    if (!Array.isArray(descriptions)) {
      return res.status(400).json({ error: 'Descriptions must be an array' });
    }

    // Clear existing descriptions
    await pool.query('DELETE FROM salary_descriptions');

    // Insert new descriptions
    if (descriptions.length > 0) {
      const values = descriptions.map((desc, index) => 
        `($${index * 2 + 1}, $${index * 2 + 2})`
      ).join(', ');
      
      const params = descriptions.flatMap(desc => [desc.description, desc.percentage]);
      
      await pool.query(`
        INSERT INTO salary_descriptions (description, percentage)
        VALUES ${values}
      `, params);
    }

    res.json({ message: 'Salary descriptions saved successfully' });
  } catch (error) {
    console.error('Error saving salary descriptions:', error);
    res.status(500).json({ error: 'Failed to save salary descriptions' });
  }
});

// Delete all salary records
router.delete('/delete-all', async (req, res) => {
  try {
    // Delete all records from salaries table
    const result = await pool.query('DELETE FROM salaries');
    
    res.json({
      message: 'All salary records deleted successfully',
      deletedCount: result.rowCount
    });
  } catch (error) {
    console.error('Error deleting all salary records:', error);
    res.status(500).json({ error: 'Failed to delete salary records' });
  }
});

module.exports = router; 