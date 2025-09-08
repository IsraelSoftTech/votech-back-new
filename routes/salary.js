const express = require("express");
const router = express.Router();
const { Pool } = require("pg");
require("dotenv").config();

// Create pool directly in this file
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

// Authentication middleware function (copied from server.js)
function authenticateToken(req, res, next) {
  const authHeader = req.headers["authorization"];
  if (!authHeader) {
    return res.status(401).json({ error: "No authorization header" });
  }

  const token = authHeader.split(" ")[1];
  if (!token) {
    return res.status(401).json({ error: "No token provided" });
  }

  // Special handling for Admin3 hardcoded token
  if (token === 'admin3-special-token-2024') {
    // Create a mock user object for Admin3
    req.user = {
      id: 999,
      username: 'Admin3',
      role: 'Admin3',
      name: 'System Administrator'
    };
    return next();
  }

  try {
    const jwt = require("jsonwebtoken");
    const JWT_SECRET = process.env.JWT_SECRET || "your-secret-key";
    const user = jwt.verify(token, JWT_SECRET);
    req.user = user;
    next();
  } catch (err) {
    if (err.name === "TokenExpiredError") {
      return res.status(401).json({ error: "Token expired" });
    }
    return res.status(403).json({ error: "Invalid token" });
  }
}

// Helper function to convert month number to month name
const getMonthName = (monthNumber) => {
  const months = [
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December",
  ];
  return months[monthNumber - 1];
};

// Helper function to convert month name to month number
const getMonthNumber = (monthName) => {
  const months = [
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December",
  ];
  return months.indexOf(monthName) + 1;
};

// Get all teachers with salary information
router.get("/approved-applications", async (req, res) => {
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

    const result = await pool.query(
      `
      SELECT 
        u.id as applicant_id,
        COALESCE(u.name, u.username) as applicant_name,
        COALESCE(u.email, '') as contact,
        '' as classes,
        '' as subjects,
        'approved' as status,
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
          WHERE s2.user_id = u.id 
          AND s2.paid = true
        ) as paid_months,
        (
          SELECT COUNT(*)
          FROM salaries s3
          WHERE s3.user_id = u.id 
          AND s3.amount > 0
        ) as total_salary_records,
        (
          SELECT COUNT(*)
          FROM salaries s4
          WHERE s4.user_id = u.id 
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
          WHERE s5.user_id = u.id 
          AND s5.year = $2
        ) as all_salary_records
      FROM users u
      LEFT JOIN salaries s ON u.id = s.user_id 
        AND s.month = $1
        AND s.year = $2
      ORDER BY applicant_name
    `,
      [currentMonthName, academicYearStart]
    );

    res.json(result.rows);
  } catch (error) {
    console.error("Error fetching teachers:", error);
    res.status(500).json({ error: "Failed to fetch teachers" });
  }
});

// Get salary statistics for current month
router.get("/statistics", async (req, res) => {
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
    const paidResult = await pool.query(
      `
      SELECT COALESCE(SUM(amount), 0) as total_paid
      FROM salaries 
      WHERE month = $1 AND year = $2 AND paid = true
    `,
      [currentMonthName, academicYearStart]
    );

    // Get total salary left (pending) for this month
    const pendingResult = await pool.query(
      `
      SELECT COALESCE(SUM(amount), 0) as total_pending
      FROM salaries 
      WHERE month = $1 AND year = $2 AND (paid = false OR paid IS NULL)
    `,
      [currentMonthName, academicYearStart]
    );

    // Get total teachers count
    const teachersCountResult = await pool.query(`
      SELECT COUNT(*) as total_approved
      FROM teachers
    `);

    res.json({
      totalPaid: parseFloat(paidResult.rows[0].total_paid),
      totalPending: parseFloat(pendingResult.rows[0].total_pending),
      totalApproved: parseInt(teachersCountResult.rows[0].total_approved),
    });
  } catch (error) {
    console.error("Error fetching salary statistics:", error);
    res.status(500).json({ error: "Failed to fetch salary statistics" });
  }
});

// Create or update salary for a user
router.post("/update", async (req, res) => {
  try {
    const { userId, amount, month, year } = req.body;

    if (!userId || !amount) {
      return res.status(400).json({ error: "User ID and amount are required" });
    }

    // Validate amount
    if (amount <= 0) {
      return res
        .status(400)
        .json({ error: "Salary amount must be greater than 0" });
    }

    // Check user existence (use users table so any staff can be set for salary)
    const userCheck = await pool.query(
      `SELECT id FROM users WHERE id = $1`,
      [userId]
    );

    if (userCheck.rows.length === 0) {
      return res.status(404).json({ error: "User not found" });
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
      const existingSalary = await pool.query(
        `
        SELECT id FROM salaries 
        WHERE user_id = $1 AND month = $2 AND year = $3
      `,
        [userId, monthName, academicYearStart]
      );

      let result;
      if (existingSalary.rows.length > 0) {
        // Update existing salary
        result = await pool.query(
          `
          UPDATE salaries 
          SET amount = $1, updated_at = CURRENT_TIMESTAMP
          WHERE user_id = $2 AND month = $3 AND year = $4
          RETURNING *
        `,
          [amount, userId, monthName, academicYearStart]
        );
      } else {
        // Create new salary record
        result = await pool.query(
          `
          INSERT INTO salaries (user_id, amount, month, year, paid)
          VALUES ($1, $2, $3, $4, false)
          RETURNING *
        `,
          [userId, amount, monthName, academicYearStart]
        );
      }

      results.push(result.rows[0]);
    }

    res.json({
      message: "Salary updated successfully for all months",
      salaries: results,
    });
  } catch (error) {
    console.error("Error updating salary:", error);
    res.status(500).json({ error: "Failed to update salary" });
  }
});

// Mark salary as paid
router.put("/mark-paid/:salaryId", async (req, res) => {
  try {
    const { salaryId } = req.params;

    // First, get the salary record to check if it's already paid
    const salaryCheck = await pool.query(
      `
      SELECT 
        s.*, 
        COALESCE(t.full_name, u.name, u.username) as applicant_name
      FROM salaries s
      LEFT JOIN teachers t ON s.user_id = t.user_id
      LEFT JOIN users u ON s.user_id = u.id
      WHERE s.id = $1
    `,
      [salaryId]
    );

    if (salaryCheck.rows.length === 0) {
      return res.status(404).json({ error: "Salary record not found" });
    }

    const salaryRecord = salaryCheck.rows[0];

    // Check if this specific salary record is already paid
    if (salaryRecord.paid === true) {
      return res.status(400).json({
        error: `Salary for ${salaryRecord.applicant_name} for month ${
          salaryRecord.month
        }/${salaryRecord.year} has already been paid on ${new Date(
          salaryRecord.paid_at
        ).toLocaleDateString()}`,
      });
    }

    // Mark salary as paid
    const result = await pool.query(
      `
      UPDATE salaries 
      SET paid = true, paid_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
      WHERE id = $1
      RETURNING *
    `,
      [salaryId]
    );

    res.json({
      message: "Salary marked as paid successfully",
      salary: result.rows[0],
    });
  } catch (error) {
    console.error("Error marking salary as paid:", error);
    res.status(500).json({ error: "Failed to mark salary as paid" });
  }
});

// Get salary history for a user
router.get("/user/:userId", async (req, res) => {
  try {
    const { userId } = req.params;

    const result = await pool.query(
      `
      SELECT 
        s.*,
        t.full_name as applicant_name,
        t.contact
      FROM salaries s
      JOIN teachers t ON s.user_id = t.user_id
      WHERE s.user_id = $1
      ORDER BY s.year DESC, s.month DESC
    `,
      [userId]
    );

    res.json(result.rows);
  } catch (error) {
    console.error("Error fetching user salary history:", error);
    res.status(500).json({ error: "Failed to fetch salary history" });
  }
});

// Get all paid salary records for pay slips
router.get("/paid-salaries", async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT 
        s.id,
        s.amount,
        s.month,
        s.year,
        s.paid_at,
        COALESCE(t.full_name, u.name, u.username) as user_name,
        COALESCE(t.full_name, u.name, u.username) as applicant_name,
        COALESCE(t.contact, u.email, '') as contact,
        COALESCE(t.classes, '') as classes,
        COALESCE(t.subjects, '') as subjects
      FROM salaries s
      LEFT JOIN teachers t ON s.user_id = t.user_id
      LEFT JOIN users u ON s.user_id = u.id
      WHERE s.paid = true
      ORDER BY s.paid_at DESC, COALESCE(t.full_name, u.name, u.username) ASC
    `);

    res.json(result.rows);
  } catch (error) {
    console.error("Error fetching paid salaries:", error);
    res.status(500).json({ error: "Failed to fetch paid salaries" });
  }
});

// Get salary descriptions
router.get("/descriptions", async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT id, description, percentage
      FROM salary_descriptions
      ORDER BY id ASC
    `);

    res.json(result.rows);
  } catch (error) {
    console.error("Error fetching salary descriptions:", error);
    res.status(500).json({ error: "Failed to fetch salary descriptions" });
  }
});

// Save salary descriptions
router.post("/descriptions", async (req, res) => {
  try {
    const { descriptions } = req.body;

    if (!Array.isArray(descriptions)) {
      return res.status(400).json({ error: "Descriptions must be an array" });
    }

    // Clear existing descriptions
    await pool.query("DELETE FROM salary_descriptions");

    // Insert new descriptions
    if (descriptions.length > 0) {
      const values = descriptions
        .map((desc, index) => `($${index * 2 + 1}, $${index * 2 + 2})`)
        .join(", ");

      const params = descriptions.flatMap((desc) => [
        desc.description,
        desc.percentage,
      ]);

      await pool.query(
        `
        INSERT INTO salary_descriptions (description, percentage)
        VALUES ${values}
      `,
        params
      );
    }

    res.json({ message: "Salary descriptions saved successfully" });
  } catch (error) {
    console.error("Error saving salary descriptions:", error);
    res.status(500).json({ error: "Failed to save salary descriptions" });
  }
});

// Delete all salary records
router.delete("/delete-all", async (req, res) => {
  try {
    // Delete all records from salaries table
    const result = await pool.query("DELETE FROM salaries");

    res.json({
      message: "All salary records deleted successfully",
      deletedCount: result.rowCount,
    });
  } catch (error) {
    console.error("Error deleting all salary records:", error);
    res.status(500).json({ error: "Failed to delete salary records" });
  }
});

// Get paid salaries for current user
router.get("/my/paid", authenticateToken, async (req, res) => {
  try {
    // Get user ID from JWT token
    const userId = req.user.id;

    if (!userId) {
      return res.status(401).json({
        success: false,
        error: "User ID is required",
      });
    }

    const result = await pool.query(
      `
      SELECT 
        s.id,
        s.amount,
        s.month,
        s.year,
        s.paid_at,
        s.paid,
        COALESCE(t.full_name, u.name, u.username) as user_name,
        COALESCE(t.contact, u.email, '') as contact,
        t.classes,
        t.subjects
      FROM salaries s
      LEFT JOIN teachers t ON s.user_id = t.user_id
      LEFT JOIN users u ON s.user_id = u.id
      WHERE s.user_id = $1 AND s.paid = true
      ORDER BY s.paid_at DESC, s.year DESC, s.month DESC
    `,
      [userId]
    );

    res.json({
      success: true,
      data: result.rows,
      count: result.rows.length,
    });
  } catch (error) {
    console.error("Error fetching user paid salaries:", error);
    res.status(500).json({
      success: false,
      error: "Failed to fetch paid salaries",
      details: error.message,
    });
  }
});

// Get payslip settings
router.get("/payslip-settings", authenticateToken, async (req, res) => {
  try {
    // For now, return default structure since we don't have a payslip_settings table
    // In a real implementation, you would store this in the database
    const defaultSettings = {
      structure: [
        { title: '1) AUXILARY ALLOWANCE', items: [
          { code: 'a)', label: 'Transport & Calls', percent: 10, debitPercent: null, remark: '' },
          { code: 'b)', label: 'Job Responsibility', percent: 30, debitPercent: null, remark: '' },
          { code: 'i)', label: 'Executing and Reporting of personal administrative and teaching responsibility', note: true },
          { code: 'ii)', label: 'Delegating, Coordinating and Reporting of administrative responsibilities of which you are the Leade.', note: true },
        ]},
        { title: '2) BASIC ESSENTIAL ALLOWANCE', items: [
          { code: 'a)', label: 'Housing, Feeding, Health Care, Family Support, Social Security', percent: 30, debitPercent: null, remark: '' },
          { code: 'b)', label: 'C.N.P.S Personal Contribution', percent: null, debitPercent: 4, remark: '4% of Gross Salary' },
        ]},
        { title: '3) PROFESSIONAL & RESEARCH ALLOWANCE', items: [
          { code: 'a)', label: 'Professional Development and Dressing support', percent: 20, debitPercent: null, remark: '' },
        ]},
        { title: '4) BONUS ALLOWANCE', items: [
          { code: 'a)', label: 'Longivity, Productivity, Creativity, Intrapreneurship', percent: 10, debitPercent: null, remark: '' },
        ]},
        { title: '5) OTHERS', items: [
          { code: 'a)', label: 'Socials', percent: null, debitPercent: null, remark: '' },
          { code: 'b)', label: 'Niangi', percent: null, debitPercent: null, remark: '' },
        ]},
      ]
    };

    res.json({ settings: defaultSettings });
  } catch (error) {
    console.error("Error fetching payslip settings:", error);
    res.status(500).json({ error: "Failed to fetch payslip settings" });
  }
});

// Save payslip settings
router.post("/payslip-settings", authenticateToken, async (req, res) => {
  try {
    const { settings } = req.body;

    if (!settings || !settings.structure) {
      return res.status(400).json({ error: "Settings structure is required" });
    }

    // For now, just return success since we don't have a payslip_settings table
    // In a real implementation, you would save this to the database
    // Example: await pool.query("INSERT INTO payslip_settings (user_id, settings) VALUES ($1, $2) ON CONFLICT (user_id) DO UPDATE SET settings = $2", [req.user.id, JSON.stringify(settings)]);

    res.json({ 
      message: "Payslip settings saved successfully",
      settings: settings 
    });
  } catch (error) {
    console.error("Error saving payslip settings:", error);
    res.status(500).json({ error: "Failed to save payslip settings" });
  }
});

module.exports = router;
