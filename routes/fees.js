const express = require('express');
const { pool, authenticateToken, logUserActivity, getIpAddress, getUserAgent, isAdminLike } = require('./utils');

const router = express.Router();

// Get yearly total fees
router.get('/total/yearly', authenticateToken, async (req, res) => {
  const userId = req.user.id;
  const userRole = req.user.role;
  const year = req.query.year ? parseInt(req.query.year) : new Date().getFullYear();

  try {
    let result;
    if (isAdminLike(userRole)) {
      // Admin can view total fees for all students
      result = await pool.query(`
        SELECT 
          EXTRACT(YEAR FROM paid_at) as year,
          fee_type,
          SUM(amount) as total_amount,
          COUNT(*) as payment_count
        FROM fees f
        WHERE EXTRACT(YEAR FROM paid_at) = $1
        GROUP BY EXTRACT(YEAR FROM paid_at), fee_type
        ORDER BY fee_type
      `, [year]);
    } else {
      // Regular users can only view their own students' fees
      result = await pool.query(`
        SELECT 
          EXTRACT(YEAR FROM paid_at) as year,
          fee_type,
          SUM(amount) as total_amount,
          COUNT(*) as payment_count
        FROM fees f
        JOIN students s ON f.student_id = s.id
        WHERE EXTRACT(YEAR FROM paid_at) = $1 AND s.user_id = $2
        GROUP BY EXTRACT(YEAR FROM paid_at), fee_type
        ORDER BY fee_type
      `, [year, userId]);
    }

    res.json(result.rows);
  } catch (error) {
    console.error("Error fetching yearly total fees:", error);
    res.status(500).json({
      error: "Error fetching yearly total fees",
      details: error.message
    });
  }
});

// Get student fee stats
router.get('/student/:id', authenticateToken, async (req, res) => {
  const userId = req.user.id;
  const userRole = req.user.role;
  const studentId = req.params.id;
  const year = req.query.year ? parseInt(req.query.year) : null;

  console.log(`[FEE STATS DEBUG] Fetching stats for studentId: ${studentId}, userId: ${userId}, role: ${userRole}`);

  try {
    // Get student and class with role-based access
    let resultStudent;
    if (isAdminLike(userRole)) {
      // Admins can view fees for any student
      resultStudent = await pool.query(
        "SELECT s.*, c.name as class_name, c.registration_fee, c.bus_fee, c.internship_fee, c.remedial_fee, c.tuition_fee, c.pta_fee FROM students s JOIN classes c ON s.class_id = c.id WHERE s.id = $1",
        [studentId]
      );
    } else {
      // Regular users can only view their own students' fees
      resultStudent = await pool.query(
        "SELECT s.*, c.name as class_name, c.registration_fee, c.bus_fee, c.internship_fee, c.remedial_fee, c.tuition_fee, c.pta_fee FROM students s JOIN classes c ON s.class_id = c.id WHERE s.id = $1 AND s.user_id = $2",
        [studentId, userId]
      );
    }

    const student = resultStudent.rows[0];
    if (!student) {
      console.warn(`[FEE STATS DEBUG] Student not found for id: ${studentId}`);
      return res.status(404).json({ error: "Student not found" });
    }

    // Get all fees paid
    let resultFees;
    if (year) {
      resultFees = await pool.query(
        "SELECT fee_type, SUM(amount) as paid FROM fees WHERE student_id = $1 AND EXTRACT(YEAR FROM paid_at) = $2 GROUP BY fee_type",
        [studentId, year]
      );
    } else {
      resultFees = await pool.query(
        "SELECT fee_type, SUM(amount) as paid FROM fees WHERE student_id = $1 GROUP BY fee_type",
        [studentId]
      );
    }

    // Calculate balances
    const feeMap = Object.fromEntries(
      resultFees.rows.map((f) => [f.fee_type, parseFloat(f.paid)])
    );

    const balance = {
      Registration: Math.max(0, parseFloat(student.registration_fee) - (feeMap["Registration"] || 0)),
      Bus: Math.max(0, parseFloat(student.bus_fee) - (feeMap["Bus"] || 0)),
      Internship: Math.max(0, parseFloat(student.internship_fee) - (feeMap["Internship"] || 0)),
      Remedial: Math.max(0, parseFloat(student.remedial_fee) - (feeMap["Remedial"] || 0)),
      Tuition: Math.max(0, parseFloat(student.tuition_fee) - (feeMap["Tuition"] || 0)),
      PTA: Math.max(0, parseFloat(student.pta_fee) - (feeMap["PTA"] || 0)),
    };

    console.log(`[FEE STATS DEBUG] Returning stats for studentId: ${studentId}`, { student, balance });

    res.json({ student, balance });
  } catch (error) {
    console.error("[FEE STATS DEBUG] Error fetching student fee stats:", error.stack);
    res.status(500).json({ error: "Error fetching student fees", details: error.message });
  }
});

// Create fee payment
router.post('/', authenticateToken, async (req, res) => {
  const userId = req.user.id;
  const { student_id, class_id, fee_type, amount, paid_at } = req.body;

  // Enhanced debug logging
  console.log("=== FEE PAYMENT DEBUG ===");
  console.log("[FEE DEBUG] Received request body:", JSON.stringify(req.body, null, 2));
  console.log("[FEE DEBUG] fee_type:", fee_type, "type:", typeof fee_type);
  console.log("[FEE DEBUG] student_id:", student_id);
  console.log("[FEE DEBUG] amount:", amount, "type:", typeof amount);
  console.log("=========================");

  try {
    // Validate
    const numericAmount = parseFloat(amount);
    if (Number.isNaN(numericAmount) || numericAmount <= 0) {
      return res.status(400).json({ error: "Invalid amount" });
    }

    // Fetch student's class and expected fees
    const resultStudent = await pool.query(
      "SELECT s.id as student_id, s.class_id, c.registration_fee, c.bus_fee, c.internship_fee, c.remedial_fee, c.tuition_fee, c.pta_fee FROM students s JOIN classes c ON s.class_id = c.id WHERE s.id = $1",
      [student_id]
    );

    if (resultStudent.rows.length === 0) {
      return res.status(404).json({ error: "Student not found" });
    }

    const srow = resultStudent.rows[0];

    // Sum already paid for this fee type
    const sumRes = await pool.query(
      "SELECT COALESCE(SUM(amount),0) as paid FROM fees WHERE student_id = $1 AND LOWER(fee_type) = LOWER($2)",
      [student_id, fee_type]
    );
    const alreadyPaid = parseFloat(sumRes.rows[0].paid) || 0;

    // Determine expected for this type
    const keyMap = {
      registration: "registration_fee",
      bus: "bus_fee",
      internship: "internship_fee",
      remedial: "remedial_fee",
      tuition: "tuition_fee",
      pta: "pta_fee",
    };
    const ft = String(fee_type || "").trim().toLowerCase();
    const feeKey = keyMap[ft];

    // Debug logging
    console.log("[FEE DEBUG] fee_type after conversion:", ft);
    console.log("[FEE DEBUG] feeKey found:", feeKey);

    if (!feeKey) {
      return res.status(400).json({ error: "Invalid fee type" });
    }

    const expected = parseFloat(String(srow[feeKey] || "0").replace(/,/g, ""));
    const remaining = Math.max(0, expected - alreadyPaid);

    console.log("[FEE DEBUG] Expected:", expected, "Already paid:", alreadyPaid, "Remaining:", remaining, "Amount to pay:", numericAmount);

    if (numericAmount > remaining) {
      return res.status(400).json({ error: "Amount exceeds remaining balance for this fee type" });
    }

    // Insert fee record
    let result;
    if (paid_at) {
      result = await pool.query(
        "INSERT INTO fees (student_id, class_id, fee_type, amount, paid_at) VALUES ($1, $2, $3, $4, $5)",
        [student_id, class_id, fee_type, numericAmount, paid_at]
      );
    } else {
      result = await pool.query(
        "INSERT INTO fees (student_id, class_id, fee_type, amount) VALUES ($1, $2, $3, $4)",
        [student_id, class_id, fee_type, numericAmount]
      );
    }

    // Log activity
    const ipAddress = getIpAddress(req);
    const userAgent = getUserAgent(req);
    await logUserActivity(
      userId,
      "create",
      `Fee payment: ${fee_type} - $${numericAmount}`,
      "fees",
      student_id,
      fee_type,
      ipAddress,
      userAgent
    );

    res.status(201).json({ message: "Fee payment recorded successfully" });
  } catch (error) {
    console.error("Error recording fee payment:", error);
    res.status(500).json({ error: "Error recording fee payment", details: error.message });
  }
});

// Reconcile a student's fee type total (set to an exact amount)
router.put('/reconcile', authenticateToken, async (req, res) => {
  const userId = req.user.id;
  const { student_id, fee_type, total_amount } = req.body || {};

  try {
    const studentId = parseInt(student_id);
    const desiredTotal = parseFloat(total_amount);
    if (!studentId || !fee_type || Number.isNaN(desiredTotal) || desiredTotal < 0) {
      return res.status(400).json({ error: 'Invalid payload. Require student_id, fee_type, total_amount >= 0' });
    }

    // Fetch student's class and expected fees
    const sRes = await pool.query(
      "SELECT s.id as student_id, s.class_id, c.registration_fee, c.bus_fee, c.internship_fee, c.remedial_fee, c.tuition_fee, c.pta_fee FROM students s JOIN classes c ON s.class_id = c.id WHERE s.id = $1",
      [studentId]
    );
    if (sRes.rows.length === 0) {
      return res.status(404).json({ error: 'Student not found' });
    }

    const srow = sRes.rows[0];
    const keyMap = {
      registration: 'registration_fee',
      bus: 'bus_fee',
      internship: 'internship_fee',
      remedial: 'remedial_fee',
      tuition: 'tuition_fee',
      pta: 'pta_fee',
    };
    const ft = String(fee_type || '').trim().toLowerCase();
    const feeKey = keyMap[ft];
    if (!feeKey) return res.status(400).json({ error: 'Invalid fee type' });

    const expected = parseFloat(String(srow[feeKey] || '0').replace(/,/g, '')) || 0;
    if (desiredTotal > expected) {
      return res.status(400).json({ error: `Desired total exceeds expected for ${fee_type}`, expected });
    }

    // Start transaction
    await pool.query('BEGIN');

    // Delete existing payments for this student + fee_type
    await pool.query(
      'DELETE FROM fees WHERE student_id = $1 AND LOWER(fee_type) = LOWER($2)',
      [studentId, fee_type]
    );

    // Insert a single consolidated record if desiredTotal > 0
    if (desiredTotal > 0) {
      await pool.query(
        'INSERT INTO fees (student_id, class_id, fee_type, amount) VALUES ($1, $2, $3, $4)',
        [studentId, srow.class_id, fee_type, desiredTotal]
      );
    }

    await pool.query('COMMIT');

    try {
      const ipAddress = getIpAddress(req);
      const userAgent = getUserAgent(req);
      await logUserActivity(
        userId,
        'update',
        `Reconciled ${fee_type} to ${desiredTotal}`,
        'fees',
        studentId,
        fee_type,
        ipAddress,
        userAgent
      );
    } catch (logErr) {
      console.warn('Non-critical: failed to log reconcile activity', logErr);
    }

    return res.json({ message: 'Fee reconciled successfully', student_id: studentId, fee_type, total_amount: desiredTotal });
  } catch (error) {
    await pool.query('ROLLBACK').catch(() => {});
    console.error('Error reconciling fee total:', error);
    return res.status(500).json({ error: 'Error reconciling fee total', details: error.message });
  }
});

// Get class fee stats
router.get('/class/:classId', authenticateToken, async (req, res) => {
  const userId = req.user.id;
  const userRole = req.user.role;
  const classId = req.params.classId;
  const year = req.query.year ? parseInt(req.query.year) : null;

  try {
    // First, check if the class exists
    const classCheck = await pool.query(
      "SELECT id, name FROM classes WHERE id = $1",
      [classId]
    );

    if (classCheck.rows.length === 0) {
      // Class with ID not found
      return res.status(404).json({ error: `Class with ID ${classId} not found` });
    }

    const className = classCheck.rows[0].name;
    // ClassId and ClassName processed

    // Get all students in class
    let resultStudents;
    resultStudents = await pool.query(
      "SELECT s.id, s.student_id as student_code, s.full_name, c.registration_fee, c.bus_fee, c.internship_fee, c.remedial_fee, c.tuition_fee, c.pta_fee FROM students s JOIN classes c ON s.class_id = c.id WHERE s.class_id = $1",
      [classId]
    );

    const students = resultStudents.rows;
    // Found students in class

    if (students.length > 0) {
      // Student IDs processed
    }

    if (students.length === 0) {
      return res.json([]);
    }

    // Get all fees for these students
    const studentIds = students.map((s) => s.id);
    let fees = [];

    if (studentIds.length > 0) {
      if (year) {
        const placeholders = studentIds.map((_, i) => `$${i + 1}`).join(",");
        const query = `SELECT student_id, fee_type, SUM(amount) as paid FROM fees WHERE student_id IN (${placeholders}) AND EXTRACT(YEAR FROM paid_at) = $${studentIds.length + 1} GROUP BY student_id, fee_type`;
        const params = [...studentIds, year];
        const resultFees = await pool.query(query, params);
        fees = resultFees.rows;
      } else {
        const placeholders = studentIds.map((_, i) => `$${i + 1}`).join(",");
        const query = `SELECT student_id, fee_type, SUM(amount) as paid FROM fees WHERE student_id IN (${placeholders}) GROUP BY student_id, fee_type`;
        const resultFees = await pool.query(query, studentIds);
        fees = resultFees.rows;
      }
    }

    // Map fees by student (normalize fee types)
    const feeMap = {};
    for (const f of fees) {
      if (!feeMap[f.student_id]) {
        feeMap[f.student_id] = {};
      }
      feeMap[f.student_id][f.fee_type] = parseFloat(f.paid);
    }

    // Calculate stats for each student
    const stats = students.map((student) => {
      const studentFees = feeMap[student.id] || {};
      const balance = {
        Registration: Math.max(0, parseFloat(student.registration_fee) - (studentFees["Registration"] || 0)),
        Bus: Math.max(0, parseFloat(student.bus_fee) - (studentFees["Bus"] || 0)),
        Internship: Math.max(0, parseFloat(student.internship_fee) - (studentFees["Internship"] || 0)),
        Remedial: Math.max(0, parseFloat(student.remedial_fee) - (studentFees["Remedial"] || 0)),
        Tuition: Math.max(0, parseFloat(student.tuition_fee) - (studentFees["Tuition"] || 0)),
        PTA: Math.max(0, parseFloat(student.pta_fee) - (studentFees["PTA"] || 0)),
      };

      const totalExpected = parseFloat(student.registration_fee) + parseFloat(student.bus_fee) + parseFloat(student.internship_fee) + parseFloat(student.remedial_fee) + parseFloat(student.tuition_fee) + parseFloat(student.pta_fee);
      const totalPaid = Object.values(studentFees).reduce((sum, amount) => sum + amount, 0);
      const totalBalance = totalExpected - totalPaid;

      return {
        id: student.id,
        student_id: student.student_code,
        full_name: student.full_name,
        balance,
        total_expected: totalExpected,
        total_paid: totalPaid,
        total_balance: Math.max(0, totalBalance),
        paid_fees: studentFees
      };
    });

    console.log("[FEE DEBUG] Fee stats to return:", stats);
    res.json(stats);
  } catch (error) {
    console.error("Error in /api/fees/class/:classId:", error);
    res.status(500).json({ error: "Failed to fetch class fee stats" });
  }
});

// Delete payment record
router.delete('/payments/:id', authenticateToken, async (req, res) => {
  const userId = req.user.id;
  const userRole = req.user.role;
  const paymentId = req.params.id;

  try {
    // Check if payment exists and user has permission
    let result;
    if (isAdminLike(userRole)) {
      result = await pool.query(
        "SELECT f.id FROM fees f JOIN students s ON f.student_id = s.id WHERE f.id = $1",
        [paymentId]
      );
    } else {
      result = await pool.query(
        "SELECT f.id FROM fees f JOIN students s ON f.student_id = s.id WHERE f.id = $1 AND s.user_id = $2",
        [paymentId, userId]
      );
    }

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Payment record not found" });
    }

    // Delete the payment record
    await pool.query("DELETE FROM fees WHERE id = $1", [paymentId]);

    res.json({ message: "Payment record deleted successfully" });
  } catch (error) {
    console.error("Error deleting payment record:", error);
    res.status(500).json({ error: "Error deleting payment record", details: error.message });
  }
});

// Clear all fees for a specific student
router.delete('/student/:studentId', authenticateToken, async (req, res) => {
  const userId = req.user.id;
  const userRole = req.user.role;
  const studentId = parseInt(req.params.studentId);

  console.log("=== CLEAR FEES DEBUG ===");
  console.log("Student ID:", studentId, "Type:", typeof studentId);
  console.log("User ID:", userId, "Role:", userRole);
  console.log("=========================");

  // Validate student ID
  if (isNaN(studentId)) {
    return res.status(400).json({ error: "Invalid student ID" });
  }

  try {
    // Check if student exists and user has permission
    let result;
    console.log("Is Admin Like:", isAdminLike(userRole));

    if (isAdminLike(userRole)) {
      result = await pool.query(
        "SELECT s.id, s.full_name FROM students s WHERE s.id = $1",
        [studentId]
      );
    } else {
      result = await pool.query(
        "SELECT s.id, s.full_name FROM students s WHERE s.id = $1 AND s.user_id = $2",
        [studentId, userId]
      );
    }

    console.log("Student query result:", result.rows);

    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Student not found" });
    }

    const studentName = result.rows[0].full_name;
    console.log("Student found:", studentName);

    // Delete all fee records for this student
    const deleteResult = await pool.query(
      "DELETE FROM fees WHERE student_id = $1",
      [studentId]
    );

    console.log("Delete result:", deleteResult);
    const deletedCount = deleteResult.rowCount;
    console.log("Deleted count:", deletedCount);

    // Log activity (with error handling)
    try {
      const ipAddress = getIpAddress(req);
      const userAgent = getUserAgent(req);
      await logUserActivity(
        req.user.id,
        "delete",
        `Cleared ${deletedCount} fee records for student: ${studentName}`,
        "fees",
        studentId,
        studentName,
        ipAddress,
        userAgent
      );
    } catch (logError) {
      console.error("Error logging activity (non-critical):", logError);
      // Continue execution even if logging fails
    }

    res.json({
      message: `Successfully cleared ${deletedCount} fee records for student: ${studentName}`,
      deletedCount,
      studentName
    });
  } catch (error) {
    console.error("Error clearing student fees:", error);
    res.status(500).json({ error: "Error clearing student fees", details: error.message });
  }
});

// Get individual payment details for a specific student
router.get('/payments/student/:studentId', authenticateToken, async (req, res) => {
  const userId = req.user.id;
  const userRole = req.user.role;
  const studentId = req.params.studentId;

  try {
    let result;
    if (isAdminLike(userRole)) {
      // Admins can view all payment details
      result = await pool.query(`
        SELECT 
          f.id,
          f.student_id,
          f.class_id,
          f.fee_type,
          f.amount,
          f.paid_at,
          s.full_name as student_name,
          s.student_id as student_number,
          c.name as class_name
        FROM fees f
        JOIN students s ON f.student_id = s.id
        JOIN classes c ON f.class_id = c.id
        WHERE f.student_id = $1
        ORDER BY f.paid_at DESC
      `, [studentId]);
    } else {
      // Regular users can only view their own students' payment details
      result = await pool.query(`
        SELECT 
          f.id,
          f.student_id,
          f.class_id,
          f.fee_type,
          f.amount,
          f.paid_at,
          s.full_name as student_name,
          s.student_id as student_number,
          c.name as class_name
        FROM fees f
        JOIN students s ON f.student_id = s.id
        JOIN classes c ON f.class_id = c.id
        WHERE f.student_id = $1 AND s.user_id = $2
        ORDER BY f.paid_at DESC
      `, [studentId, userId]);
    }
    res.json(result.rows);
  } catch (error) {
    console.error("Error fetching student payment details:", error);
    res.status(500).json({ error: "Error fetching student payment details", details: error.message });
  }
});

module.exports = router;

