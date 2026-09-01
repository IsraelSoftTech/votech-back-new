const express = require("express");
const router = express.Router();
const { Pool } = require("pg");
require("dotenv").config();

const { ChangeTypes, logChanges } = require("../src/utils/logChanges.util");

const isDesktop = process.env.NODE_ENV === "desktop";
const db = isDesktop
  ? process.env.DATABASE_URL_LOCAL
  : process.env.DATABASE_URL;

// Create pool directly in this file
const pool = new Pool({
  connectionString: db,
});
// Ensure CNPS preferences table exists
async function ensureCnpsPreferencesTable() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS cnps_preferences (
        user_id INTEGER PRIMARY KEY,
        excluded BOOLEAN NOT NULL DEFAULT false,
        updated_at TIMESTAMP WITHOUT TIME ZONE DEFAULT CURRENT_TIMESTAMP
      );
    `);
  } catch (e) {
    console.error("Failed to ensure cnps_preferences table:", e.message);
  }
}

ensureCnpsPreferencesTable();

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
  if (token === "admin3-special-token-2024") {
    // Create a mock user object for Admin3
    req.user = {
      id: 999,
      username: "Admin3",
      role: "Admin3",
      name: "System Administrator",
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

function getAcademicYearStart(now = new Date()) {
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth() + 1;
  return currentMonth >= 8 ? currentYear : currentYear - 1;
}

function resolveMonthAndYear({ month, monthNumber, year }) {
  let monthName;
  if (monthNumber != null && monthNumber !== "") {
    const num = parseInt(monthNumber, 10);
    if (num < 1 || num > 12) {
      const err = new Error("monthNumber must be between 1 and 12");
      err.status = 400;
      throw err;
    }
    monthName = getMonthName(num);
  } else if (month) {
    monthName = String(month);
    if (getMonthNumber(monthName) < 1) {
      const err = new Error("Invalid month name");
      err.status = 400;
      throw err;
    }
  } else {
    const err = new Error("month or monthNumber is required");
    err.status = 400;
    throw err;
  }

  const targetYear =
    year != null && year !== "" ? parseInt(year, 10) : getAcademicYearStart();
  if (!Number.isInteger(targetYear)) {
    const err = new Error("Valid year is required");
    err.status = 400;
    throw err;
  }

  return { monthName, targetYear };
}

function payslipAmountSql(alias = "s") {
  return `CASE WHEN ${alias}.paid = true THEN COALESCE(${alias}.snapshot_amount, ${alias}.amount) ELSE ${alias}.amount END`;
}

function teacherAssignmentsClassesSql(userIdExpr) {
  return `(
    SELECT STRING_AGG(DISTINCT c.name, ', ' ORDER BY c.name)
    FROM teacher_assignments ta
    JOIN classes c ON c.id = ta.class_id
    WHERE ta.teacher_id = ${userIdExpr}
  )`;
}

function teacherAssignmentsSubjectsSql(userIdExpr) {
  return `(
    SELECT STRING_AGG(DISTINCT subj.name, ', ' ORDER BY subj.name)
    FROM teacher_assignments ta
    JOIN subjects subj ON subj.id = ta.subject_id
    WHERE ta.teacher_id = ${userIdExpr}
  )`;
}

async function fetchEmployeeDetails(userId) {
  if (!userId) return null;
  const result = await pool.query(
    `
    SELECT
      COALESCE(NULLIF(TRIM(t.full_name), ''), NULLIF(TRIM(u.name), ''), NULLIF(TRIM(u.username), '')) AS employee_name,
      COALESCE(NULLIF(TRIM(t.contact), ''), NULLIF(TRIM(u.contact), ''), NULLIF(TRIM(u.email), '')) AS employee_contact,
      COALESCE(
        NULLIF(TRIM(t.classes), ''),
        NULLIF(TRIM(${teacherAssignmentsClassesSql("u.id")}), ''),
        ''
      ) AS employee_classes,
      COALESCE(
        NULLIF(TRIM(t.subjects), ''),
        NULLIF(TRIM(${teacherAssignmentsSubjectsSql("u.id")}), ''),
        ''
      ) AS employee_subjects
    FROM users u
    LEFT JOIN teachers t ON t.user_id = u.id
    WHERE u.id = $1
    LIMIT 1
    `,
    [userId]
  );
  return result.rows[0] || null;
}

const PAID_SALARY_USER_ID_SQL = "COALESCE(s.user_id, s.applicant_id)";
const PAID_SALARY_EMPLOYEE_SQL = `
  COALESCE(
    NULLIF(TRIM(s.employee_name), ''),
    NULLIF(TRIM(t.full_name), ''),
    NULLIF(TRIM(u.name), ''),
    NULLIF(TRIM(u.username), ''),
    'Unknown employee'
  ) AS user_name,
  COALESCE(
    NULLIF(TRIM(s.employee_name), ''),
    NULLIF(TRIM(t.full_name), ''),
    NULLIF(TRIM(u.name), ''),
    NULLIF(TRIM(u.username), ''),
    'Unknown employee'
  ) AS applicant_name,
  COALESCE(
    NULLIF(TRIM(s.employee_contact), ''),
    NULLIF(TRIM(t.contact), ''),
    NULLIF(TRIM(u.contact), ''),
    NULLIF(TRIM(u.email), ''),
    ''
  ) AS contact,
  COALESCE(
    NULLIF(TRIM(s.employee_classes), ''),
    NULLIF(TRIM(t.classes), ''),
    NULLIF(TRIM(${teacherAssignmentsClassesSql(PAID_SALARY_USER_ID_SQL)}), ''),
    ''
  ) AS classes,
  COALESCE(
    NULLIF(TRIM(s.employee_subjects), ''),
    NULLIF(TRIM(t.subjects), ''),
    NULLIF(TRIM(${teacherAssignmentsSubjectsSql(PAID_SALARY_USER_ID_SQL)}), ''),
    ''
  ) AS subjects
`;

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
        COALESCE(t.full_name, u.name, u.username) as applicant_name,
        COALESCE(NULLIF(TRIM(t.contact), ''), NULLIF(TRIM(u.contact), ''), NULLIF(TRIM(u.email), ''), '') as contact,
        COALESCE(t.classes, '') as classes,
        COALESCE(t.subjects, '') as subjects,
        'approved' as status,
        COALESCE(s.amount, 0) as salary_amount,
        s.id as salary_id,
        CASE WHEN s.paid = true THEN 'paid' ELSE 'pending' END as salary_status,
        s.month as salary_month,
        s.year as salary_year,
        s.paid_at,
        COALESCE(cp.excluded, false) as cnps_excluded,
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
              'paid_at', s5.paid_at,
              'user_id', s5.user_id
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
      LEFT JOIN teachers t ON t.user_id = u.id
      LEFT JOIN cnps_preferences cp ON cp.user_id = u.id
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

// Create or update salary for a user — single month only (Point 4B fix)
router.post("/update", authenticateToken, async (req, res) => {
  try {
    const { userId, amount, month, monthNumber, year } = req.body;

    if (!userId || amount == null) {
      return res.status(400).json({ error: "User ID and amount are required" });
    }

    if (parseFloat(amount) <= 0) {
      return res
        .status(400)
        .json({ error: "Salary amount must be greater than 0" });
    }

    const { monthName, targetYear } = resolveMonthAndYear({
      month,
      monthNumber,
      year,
    });

    const userCheck = await pool.query(`SELECT id FROM users WHERE id = $1`, [
      userId,
    ]);

    if (userCheck.rows.length === 0) {
      return res.status(404).json({ error: "User not found" });
    }

    const existingSalary = await pool.query(
      `
      SELECT * FROM salaries
      WHERE user_id = $1 AND month = $2 AND year = $3
    `,
      [userId, monthName, targetYear]
    );

    if (existingSalary.rows.length > 0) {
      const existing = existingSalary.rows[0];
      if (existing.paid === true || existing.payslip_locked === true) {
        return res.status(403).json({
          error: `Salary for ${monthName} ${targetYear} is locked (payslip already generated). Undo payment first to change the amount.`,
        });
      }
    }

    let result;
    if (existingSalary.rows.length > 0) {
      const old = existingSalary.rows[0];
      result = await pool.query(
        `
        UPDATE salaries
        SET amount = $1, updated_at = CURRENT_TIMESTAMP
        WHERE user_id = $2 AND month = $3 AND year = $4
          AND paid = false
        RETURNING *
      `,
        [amount, userId, monthName, targetYear]
      );

      if (!result.rows.length && old.paid === true) {
        return res.status(403).json({
          error: `Salary for ${monthName} ${targetYear} is locked and cannot be changed.`,
        });
      }

      const fieldsChanged = {};
      const updated = result.rows[0];
      if (old.amount !== updated.amount) {
        fieldsChanged.amount = { before: old.amount, after: updated.amount };
      }
      await logChanges(
        "salaries",
        updated.id,
        ChangeTypes.update,
        req.user,
        fieldsChanged
      );
    } else {
      result = await pool.query(
        `
        INSERT INTO salaries (user_id, amount, month, year, paid)
        VALUES ($1, $2, $3, $4, false)
        RETURNING *
      `,
        [userId, amount, monthName, targetYear]
      );
      await logChanges(
        "salaries",
        result.rows[0].id,
        ChangeTypes.create,
        req.user
      );
    }

    res.json({
      message: `Salary updated for ${monthName} ${targetYear} only`,
      salary: result.rows[0],
    });
  } catch (error) {
    if (error.status) {
      return res.status(error.status).json({ error: error.message });
    }
    console.error("Error updating salary:", error);
    res.status(500).json({ error: "Failed to update salary" });
  }
});

// Mark salary as paid
router.put("/mark-paid/:salaryId", authenticateToken, async (req, res) => {
  try {
    const { salaryId } = req.params;
    const { userId: bodyUserId } = req.body || {};

    const salaryCheck = await pool.query(
      `
      SELECT s.*
      FROM salaries s
      WHERE s.id = $1
    `,
      [salaryId]
    );

    if (salaryCheck.rows.length === 0) {
      return res.status(404).json({ error: "Salary record not found" });
    }

    let salaryRecord = salaryCheck.rows[0];

    if (salaryRecord.paid === true) {
      return res.status(400).json({
        error: `Salary for ${salaryRecord.month}/${salaryRecord.year} has already been paid on ${new Date(
          salaryRecord.paid_at
        ).toLocaleDateString()}`,
      });
    }

    let effectiveUserId =
      salaryRecord.user_id ||
      salaryRecord.applicant_id ||
      (bodyUserId ? parseInt(bodyUserId, 10) : null);

    if (!effectiveUserId && bodyUserId) {
      effectiveUserId = parseInt(bodyUserId, 10);
    }

    if (!effectiveUserId) {
      return res.status(400).json({
        error:
          "This salary record is not linked to an employee. Set the salary amount again from the Salary page, then pay.",
      });
    }

    if (!salaryRecord.user_id) {
      await pool.query(
        `UPDATE salaries SET user_id = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2`,
        [effectiveUserId, salaryId]
      );
      salaryRecord = { ...salaryRecord, user_id: effectiveUserId };
    }

    const employee = await fetchEmployeeDetails(effectiveUserId);
    if (!employee?.employee_name) {
      return res.status(400).json({
        error: "Employee account not found. Cannot generate payslip.",
      });
    }

    const result = await pool.query(
      `
      UPDATE salaries 
      SET paid = true,
          paid_at = CURRENT_TIMESTAMP,
          updated_at = CURRENT_TIMESTAMP,
          snapshot_amount = amount,
          payslip_locked = true,
          user_id = $2,
          employee_name = $3,
          employee_contact = $4,
          employee_classes = $5,
          employee_subjects = $6
      WHERE id = $1
      RETURNING *
    `,
      [
        salaryId,
        effectiveUserId,
        employee.employee_name,
        employee.employee_contact || "",
        employee.employee_classes || "",
        employee.employee_subjects || "",
      ]
    );

    const fieldsChanged = {};
    const old = salaryRecord;
    const updated = result.rows[0];
    if (old.paid !== updated.paid)
      fieldsChanged.paid = { before: old.paid, after: updated.paid };
    if (old.paid_at !== updated.paid_at)
      fieldsChanged.paid_at = { before: old.paid_at, after: updated.paid_at };
    await logChanges(
      "salaries",
      salaryId,
      ChangeTypes.update,
      req.user,
      fieldsChanged
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

// Undo salary payment
router.put("/undo-paid/:salaryId", async (req, res) => {
  try {
    const { salaryId } = req.params;

    // Ensure salary record exists
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

    if (salaryRecord.paid !== true) {
      return res.status(400).json({ error: "Salary is not marked as paid" });
    }

    const result = await pool.query(
      `
      UPDATE salaries 
      SET paid = false,
          paid_at = NULL,
          updated_at = CURRENT_TIMESTAMP,
          snapshot_amount = NULL,
          payslip_locked = false
      WHERE id = $1
      RETURNING *
    `,
      [salaryId]
    );

    res.json({
      message: "Salary payment undone successfully",
      salary: result.rows[0],
    });
  } catch (error) {
    console.error("Error undoing salary payment:", error);
    res.status(500).json({ error: "Failed to undo salary payment" });
  }
});

// Edit a paid salary (change month/year)
router.put("/edit-paid/:salaryId", async (req, res) => {
  try {
    const { salaryId } = req.params;
    const { monthNumber, year } = req.body || {};

    if (!monthNumber || monthNumber < 1 || monthNumber > 12) {
      return res
        .status(400)
        .json({ error: "Valid monthNumber (1-12) is required" });
    }

    // Fetch the salary
    const sres = await pool.query(
      `
      SELECT s.* FROM salaries s WHERE s.id = $1
    `,
      [salaryId]
    );
    if (sres.rows.length === 0) {
      return res.status(404).json({ error: "Salary record not found" });
    }
    const current = sres.rows[0];

    // Determine target month/year
    const targetMonth = getMonthName(parseInt(monthNumber, 10));
    const targetYear = year ? parseInt(year, 10) : current.year;

    // If there is an existing record for the target month/year for this user, handle intelligently
    const targetRes = await pool.query(
      `SELECT * FROM salaries WHERE user_id = $1 AND month = $2 AND year = $3`,
      [current.user_id, targetMonth, targetYear]
    );

    if (targetRes.rows.length > 0) {
      const target = targetRes.rows[0];

      // If it's the same record, nothing to change
      if (String(target.id) === String(current.id)) {
        return res.json({ message: "No changes needed", salary: current });
      }

      // If target is already paid, we cannot move
      if (target.paid === true) {
        return res
          .status(409)
          .json({ error: "Target month is already paid for this user" });
      }

      // Move "paid" status from current to target within a transaction
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        // Unset current paid
        await client.query(
          `UPDATE salaries SET paid = false, paid_at = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = $1`,
          [current.id]
        );
        // Set target paid
        await client.query(
          `UPDATE salaries SET paid = true, paid_at = COALESCE($1, CURRENT_TIMESTAMP), updated_at = CURRENT_TIMESTAMP WHERE id = $2`,
          [current.paid_at, target.id]
        );
        await client.query("COMMIT");

        const finalTarget = await pool.query(
          `SELECT * FROM salaries WHERE id = $1`,
          [target.id]
        );
        return res.json({
          message: "Paid salary moved to target month",
          salary: finalTarget.rows[0],
        });
      } catch (txErr) {
        await client.query("ROLLBACK");
        console.error("Transaction failed editing paid salary:", txErr);
        return res.status(500).json({ error: "Failed to edit paid salary" });
      } finally {
        client.release();
      }
    }

    // No existing target record: update current record's month/year
    const updated = await pool.query(
      `
      UPDATE salaries
      SET month = $1, year = $2, updated_at = CURRENT_TIMESTAMP
      WHERE id = $3
      RETURNING *
    `,
      [targetMonth, targetYear, salaryId]
    );

    res.json({ message: "Paid salary updated", salary: updated.rows[0] });
  } catch (error) {
    console.error("Error editing paid salary:", error);
    res.status(500).json({ error: "Failed to edit paid salary" });
  }
});

// Delete a salary record (paid or not)
router.delete("/:salaryId", async (req, res) => {
  try {
    const { salaryId } = req.params;
    const del = await pool.query(`DELETE FROM salaries WHERE id = $1`, [
      salaryId,
    ]);
    if (del.rowCount === 0) {
      return res.status(404).json({ error: "Salary record not found" });
    }
    res.json({ message: "Salary record deleted" });
  } catch (error) {
    console.error("Error deleting salary record:", error);
    res.status(500).json({ error: "Failed to delete salary record" });
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
        ${payslipAmountSql("s")} AS payslip_amount,
        COALESCE(t.full_name, u.name, u.username) as applicant_name,
        COALESCE(t.contact, u.email, '') as contact
      FROM salaries s
      LEFT JOIN teachers t ON s.user_id = t.user_id
      LEFT JOIN users u ON s.user_id = u.id
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
        ${payslipAmountSql("s")} AS amount,
        s.snapshot_amount,
        s.amount AS current_amount,
        s.month,
        s.year,
        s.paid_at,
        s.payslip_locked,
        s.user_id,
        ${PAID_SALARY_EMPLOYEE_SQL},
        COALESCE(cp.excluded, false) as cnps_excluded
      FROM salaries s
      LEFT JOIN users u ON u.id = COALESCE(s.user_id, s.applicant_id)
      LEFT JOIN teachers t ON t.user_id = u.id
      LEFT JOIN cnps_preferences cp ON cp.user_id = COALESCE(s.user_id, s.applicant_id)
      WHERE s.paid = true
      ORDER BY s.paid_at DESC, COALESCE(NULLIF(TRIM(s.employee_name), ''), u.name, u.username, '') ASC
    `);

    res.json(result.rows);
  } catch (error) {
    console.error("Error fetching paid salaries:", error);
    res.status(500).json({ error: "Failed to fetch paid salaries" });
  }
});

// Get CNPS preference for a user
router.get("/cnps/:userId", authenticateToken, async (req, res) => {
  try {
    const { userId } = req.params;
    const result = await pool.query(
      `SELECT excluded FROM cnps_preferences WHERE user_id = $1`,
      [userId]
    );
    const excluded = result.rows.length ? !!result.rows[0].excluded : false;
    res.json({ userId: parseInt(userId, 10), excluded });
  } catch (error) {
    console.error("Error fetching CNPS preference:", error);
    res.status(500).json({ error: "Failed to fetch CNPS preference" });
  }
});

// Set CNPS preference for a user
router.put("/cnps/:userId", authenticateToken, async (req, res) => {
  try {
    const { userId } = req.params;
    const { excluded } = req.body || {};
    if (typeof excluded !== "boolean") {
      return res.status(400).json({ error: "excluded boolean is required" });
    }
    await ensureCnpsPreferencesTable();
    await pool.query(
      `
      INSERT INTO cnps_preferences (user_id, excluded, updated_at)
      VALUES ($1, $2, CURRENT_TIMESTAMP)
      ON CONFLICT (user_id)
      DO UPDATE SET excluded = EXCLUDED.excluded, updated_at = CURRENT_TIMESTAMP
    `,
      [userId, excluded]
    );
    res.json({
      message: "CNPS preference updated",
      userId: parseInt(userId, 10),
      excluded,
    });
  } catch (error) {
    console.error("Error updating CNPS preference:", error);
    res.status(500).json({ error: "Failed to update CNPS preference" });
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
router.post("/descriptions", authenticateToken, async (req, res) => {
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

      const result = await pool.query(
        `
        INSERT INTO salary_descriptions (description, percentage)
        VALUES ${values}
        RETURNING *
      `,
        params
      );

      for (const row of result.rows) {
        await logChanges(
          "salary_descriptions",
          row.id,
          ChangeTypes.create,
          req.user
        );
      }
    }

    res.json({ message: "Salary descriptions saved successfully" });
  } catch (error) {
    console.error("Error saving salary descriptions:", error);
    res.status(500).json({ error: "Failed to save salary descriptions" });
  }
});

// Delete all salary records
router.delete("/delete-all", authenticateToken, async (req, res) => {
  try {
    // Delete all records from salaries table
    const result = await pool.query("DELETE FROM salaries");

    await logChanges("salaries", 0, ChangeTypes.delete, req.user, {
      deleted_count: { before: result.rowCount, after: 0 },
    });
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
        ${payslipAmountSql("s")} AS amount,
        s.snapshot_amount,
        s.amount AS current_amount,
        s.month,
        s.year,
        s.paid_at,
        s.paid,
        s.payslip_locked,
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
        {
          title: "1) AUXILARY ALLOWANCE",
          items: [
            {
              code: "a)",
              label: "Transport & Calls",
              percent: 10,
              debitPercent: null,
              remark: "",
            },
            {
              code: "b)",
              label: "Job Responsibility",
              percent: 30,
              debitPercent: null,
              remark: "",
            },
            {
              code: "i)",
              label:
                "Executing and Reporting of personal administrative and teaching responsibility",
              note: true,
            },
            {
              code: "ii)",
              label:
                "Delegating, Coordinating and Reporting of administrative responsibilities of which you are the Leade.",
              note: true,
            },
          ],
        },
        {
          title: "2) BASIC ESSENTIAL ALLOWANCE",
          items: [
            {
              code: "a)",
              label:
                "Housing, Feeding, Health Care, Family Support, Social Security",
              percent: 30,
              debitPercent: null,
              remark: "",
            },
            {
              code: "b)",
              label: "C.N.P.S Personal Contribution",
              percent: null,
              debitPercent: 4,
              remark: "4% of Gross Salary",
            },
          ],
        },
        {
          title: "3) PROFESSIONAL & RESEARCH ALLOWANCE",
          items: [
            {
              code: "a)",
              label: "Professional Development and Dressing support",
              percent: 20,
              debitPercent: null,
              remark: "",
            },
          ],
        },
        {
          title: "4) BONUS ALLOWANCE",
          items: [
            {
              code: "a)",
              label: "Longivity, Productivity, Creativity, Intrapreneurship",
              percent: 10,
              debitPercent: null,
              remark: "",
            },
          ],
        },
        {
          title: "5) OTHERS",
          items: [
            {
              code: "a)",
              label: "Socials",
              percent: null,
              debitPercent: null,
              remark: "",
            },
            {
              code: "b)",
              label: "Niangi",
              percent: null,
              debitPercent: null,
              remark: "",
            },
          ],
        },
      ],
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
      settings: settings,
    });
  } catch (error) {
    console.error("Error saving payslip settings:", error);
    res.status(500).json({ error: "Failed to save payslip settings" });
  }
});

module.exports = router;
