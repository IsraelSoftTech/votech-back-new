const express = require("express");
const {
  pool,
  authenticateToken,
  logUserActivity,
  getIpAddress,
  getUserAgent,
  isAdminLike,
} = require("./utils");
const { ChangeTypes, logChanges } = require("../src/utils/logChanges.util");
const {
  buildStudentFeePayload,
  computeBaseFee,
  parseFeeAmount,
} = require("../src/services/feeCalculation.service");

const router = express.Router();

async function getActiveAcademicYearId() {
  const result = await pool.query(`
    SELECT id FROM "academicYears"
    WHERE status = 'active' AND "deletedAt" IS NULL
    ORDER BY id DESC
    LIMIT 1
  `);
  return result.rows[0]?.id ?? null;
}

async function fetchDiscountForStudent(studentId, academicYearId) {
  if (!academicYearId) return null;
  const result = await pool.query(
    `SELECT * FROM student_fee_discounts
     WHERE student_id = $1 AND academic_year_id = $2
     LIMIT 1`,
    [studentId, academicYearId]
  );
  return result.rows[0] || null;
}

async function fetchDiscountMap(studentIds, academicYearId) {
  if (!studentIds.length || !academicYearId) return {};
  const placeholders = studentIds.map((_, i) => `$${i + 2}`).join(",");
  const result = await pool.query(
    `SELECT * FROM student_fee_discounts
     WHERE academic_year_id = $1 AND student_id IN (${placeholders})`,
    [academicYearId, ...studentIds]
  );
  const map = {};
  result.rows.forEach((row) => {
    map[row.student_id] = row;
  });
  return map;
}

function requireAdminFinance(req, res) {
  if (!isAdminLike(req.user.role)) {
    res.status(403).json({ error: "Admin access required" });
    return false;
  }
  return true;
}

// Get fee totals summary (single query - fast)
router.get("/totals/summary", authenticateToken, async (req, res) => {
  const userId = req.user.id;
  const userRole = req.user.role;
  try {
    const academicYearId = await getActiveAcademicYearId();
    let result;
    if (isAdminLike(userRole)) {
      result = await pool.query(
        `
        WITH student_base AS (
          SELECT
            s.id,
            (
              COALESCE(NULLIF(REGEXP_REPLACE(TRIM(c.registration_fee), '[^0-9.]', '', 'g'), '')::numeric, 0) +
              COALESCE(NULLIF(REGEXP_REPLACE(TRIM(c.bus_fee), '[^0-9.]', '', 'g'), '')::numeric, 0) +
              COALESCE(NULLIF(REGEXP_REPLACE(TRIM(c.internship_fee), '[^0-9.]', '', 'g'), '')::numeric, 0) +
              COALESCE(NULLIF(REGEXP_REPLACE(TRIM(c.remedial_fee), '[^0-9.]', '', 'g'), '')::numeric, 0) +
              COALESCE(NULLIF(REGEXP_REPLACE(TRIM(c.tuition_fee), '[^0-9.]', '', 'g'), '')::numeric, 0) +
              COALESCE(NULLIF(REGEXP_REPLACE(TRIM(c.pta_fee), '[^0-9.]', '', 'g'), '')::numeric, 0)
            ) AS base_fee
          FROM students s
          JOIN classes c ON s.class_id = c.id
          WHERE s."deletedAt" IS NULL
        ),
        discounted AS (
          SELECT
            sb.id,
            GREATEST(
              0,
              sb.base_fee - COALESCE(LEAST(d.discount_amount, sb.base_fee), 0)
            ) AS net_expected
          FROM student_base sb
          LEFT JOIN student_fee_discounts d
            ON d.student_id = sb.id
           AND d.academic_year_id = $1
        )
        SELECT
          COALESCE((SELECT SUM(net_expected) FROM discounted), 0) AS total_expected,
          COALESCE((
            SELECT SUM(f.amount)
            FROM fees f
            JOIN students st ON f.student_id = st.id
            WHERE st."deletedAt" IS NULL
          ), 0) AS total_paid
      `,
        [academicYearId]
      );
    } else {
      result = await pool.query(
        `
        WITH student_base AS (
          SELECT
            s.id,
            (
              COALESCE(NULLIF(REGEXP_REPLACE(TRIM(c.registration_fee), '[^0-9.]', '', 'g'), '')::numeric, 0) +
              COALESCE(NULLIF(REGEXP_REPLACE(TRIM(c.bus_fee), '[^0-9.]', '', 'g'), '')::numeric, 0) +
              COALESCE(NULLIF(REGEXP_REPLACE(TRIM(c.internship_fee), '[^0-9.]', '', 'g'), '')::numeric, 0) +
              COALESCE(NULLIF(REGEXP_REPLACE(TRIM(c.remedial_fee), '[^0-9.]', '', 'g'), '')::numeric, 0) +
              COALESCE(NULLIF(REGEXP_REPLACE(TRIM(c.tuition_fee), '[^0-9.]', '', 'g'), '')::numeric, 0) +
              COALESCE(NULLIF(REGEXP_REPLACE(TRIM(c.pta_fee), '[^0-9.]', '', 'g'), '')::numeric, 0)
            ) AS base_fee
          FROM students s
          JOIN classes c ON s.class_id = c.id
          WHERE s.user_id = $2 AND s."deletedAt" IS NULL
        ),
        discounted AS (
          SELECT
            sb.id,
            GREATEST(
              0,
              sb.base_fee - COALESCE(LEAST(d.discount_amount, sb.base_fee), 0)
            ) AS net_expected
          FROM student_base sb
          LEFT JOIN student_fee_discounts d
            ON d.student_id = sb.id
           AND d.academic_year_id = $1
        )
        SELECT
          COALESCE((SELECT SUM(net_expected) FROM discounted), 0) AS total_expected,
          COALESCE((
            SELECT SUM(f.amount)
            FROM fees f
            JOIN students st ON f.student_id = st.id
            WHERE st.user_id = $2 AND st."deletedAt" IS NULL
          ), 0) AS total_paid
      `,
        [academicYearId, userId]
      );
    }
    const row = result.rows[0];
    const totalExpected = parseFloat(row?.total_expected) || 0;
    const totalPaid = parseFloat(row?.total_paid) || 0;
    res.json({ totalPaid, totalOwed: Math.max(0, totalExpected - totalPaid) });
  } catch (error) {
    console.error("Error fetching fee totals:", error);
    res.status(500).json({ error: "Error fetching totals", details: error.message });
  }
});

// Get yearly total fees
router.get("/total/yearly", authenticateToken, async (req, res) => {
  const userId = req.user.id;
  const userRole = req.user.role;
  const year = req.query.year
    ? parseInt(req.query.year)
    : new Date().getFullYear();

  try {
    let result;
    if (isAdminLike(userRole)) {
      // Admin can view total fees for all students
      result = await pool.query(
        `
        SELECT 
          EXTRACT(YEAR FROM paid_at) as year,
          fee_type,
          SUM(amount) as total_amount,
          COUNT(*) as payment_count
        FROM fees f
        WHERE EXTRACT(YEAR FROM paid_at) = $1
        GROUP BY EXTRACT(YEAR FROM paid_at), fee_type
        ORDER BY fee_type
      `,
        [year]
      );
    } else {
      // Regular users can only view their own students' fees
      result = await pool.query(
        `
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
      `,
        [year, userId]
      );
    }

    res.json(result.rows);
  } catch (error) {
    console.error("Error fetching yearly total fees:", error);
    res.status(500).json({
      error: "Error fetching yearly total fees",
      details: error.message,
    });
  }
});

// Get fee stats for multiple students (batch - for fast table loading)
router.get("/students/batch", authenticateToken, async (req, res) => {
  const userId = req.user.id;
  const userRole = req.user.role;
  const idsParam = req.query.ids;
  if (!idsParam || typeof idsParam !== "string") {
    return res.status(400).json({ error: "ids query param required (comma-separated)" });
  }
  const studentIds = idsParam.split(",").map((id) => id.trim()).filter(Boolean);
  if (studentIds.length === 0 || studentIds.length > 100) {
    return res.status(400).json({ error: "ids must have 1-100 student IDs" });
  }

  try {
    const placeholders = studentIds.map((_, i) => `$${i + 1}`).join(",");
    let resultStudents;
    if (isAdminLike(userRole)) {
      resultStudents = await pool.query(
        `SELECT s.*, c.name as class_name, c.registration_fee, c.bus_fee, c.internship_fee, c.remedial_fee, c.tuition_fee, c.pta_fee 
         FROM students s JOIN classes c ON s.class_id = c.id 
         WHERE s.id IN (${placeholders})`,
        studentIds
      );
    } else {
      resultStudents = await pool.query(
        `SELECT s.*, c.name as class_name, c.registration_fee, c.bus_fee, c.internship_fee, c.remedial_fee, c.tuition_fee, c.pta_fee 
         FROM students s JOIN classes c ON s.class_id = c.id 
         WHERE s.id IN (${placeholders}) AND s.user_id = $${studentIds.length + 1}`,
        [...studentIds, userId]
      );
    }

    const resultFees = await pool.query(
      `SELECT student_id, fee_type, SUM(amount) as paid 
       FROM fees WHERE student_id IN (${placeholders}) 
       GROUP BY student_id, fee_type`,
      studentIds
    );

    const feeMap = {};
    resultFees.rows.forEach((f) => {
      if (!feeMap[f.student_id]) feeMap[f.student_id] = {};
      feeMap[f.student_id][f.fee_type] = parseFloat(f.paid);
    });

    const academicYearId = await getActiveAcademicYearId();
    const discountMap = await fetchDiscountMap(
      resultStudents.rows.map((s) => s.id),
      academicYearId
    );

    const batch = {};
    resultStudents.rows.forEach((student) => {
      const fm = feeMap[student.id] || {};
      batch[student.id] = buildStudentFeePayload(
        student,
        fm,
        discountMap[student.id]
      );
    });

    res.json(batch);
  } catch (error) {
    console.error("Error fetching batch fee stats:", error);
    res.status(500).json({ error: "Error fetching fee stats", details: error.message });
  }
});

// Get student fee stats
router.get("/student/:id", authenticateToken, async (req, res) => {
  const userId = req.user.id;
  const userRole = req.user.role;
  const studentId = req.params.id;
  const year = req.query.year ? parseInt(req.query.year) : null;

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

    const academicYearId = await getActiveAcademicYearId();
    const discountRow = await fetchDiscountForStudent(studentId, academicYearId);
    const payload = buildStudentFeePayload(student, feeMap, discountRow);

    res.json(payload);
  } catch (error) {
    console.error(
      "[FEE STATS DEBUG] Error fetching student fee stats:",
      error.stack
    );
    res
      .status(500)
      .json({ error: "Error fetching student fees", details: error.message });
  }
});

// Create fee payment
router.post("/", authenticateToken, async (req, res) => {
  const userId = req.user.id;
  const { student_id, class_id, fee_type, amount, paid_at } = req.body;

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
    const ft = String(fee_type || "")
      .trim()
      .toLowerCase();
    const feeKey = keyMap[ft];

    if (!feeKey) {
      return res.status(400).json({ error: "Invalid fee type" });
    }

    const expected = parseFloat(String(srow[feeKey] || "0").replace(/,/g, ""));
    const remaining = Math.max(0, expected - alreadyPaid);

    if (numericAmount > remaining) {
      return res
        .status(400)
        .json({ error: "Amount exceeds remaining balance for this fee type" });
    }

    // Insert fee record
    let result;
    if (paid_at) {
      result = await pool.query(
        "INSERT INTO fees (student_id, class_id, fee_type, amount, paid_at) VALUES ($1, $2, $3, $4, $5) RETURNING *",
        [student_id, class_id, fee_type, numericAmount, paid_at]
      );
    } else {
      result = await pool.query(
        "INSERT INTO fees (student_id, class_id, fee_type, amount) VALUES ($1, $2, $3, $4) RETURNING *",
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

    await logChanges("fees", result.rows[0].id, ChangeTypes.create, req.user);
    res.status(201).json({ message: "Fee payment recorded successfully" });
  } catch (error) {
    console.error("Error recording fee payment:", error);
    res
      .status(500)
      .json({ error: "Error recording fee payment", details: error.message });
  }
});

// Reconcile a student's fee type total (set to an exact amount)
router.put("/reconcile", authenticateToken, async (req, res) => {
  const userId = req.user.id;
  const { student_id, fee_type, total_amount } = req.body || {};

  try {
    const studentId = parseInt(student_id);
    const desiredTotal = parseFloat(total_amount);
    if (
      !studentId ||
      !fee_type ||
      Number.isNaN(desiredTotal) ||
      desiredTotal < 0
    ) {
      return res
        .status(400)
        .json({
          error:
            "Invalid payload. Require student_id, fee_type, total_amount >= 0",
        });
    }

    // Fetch student's class and expected fees
    const sRes = await pool.query(
      "SELECT s.id as student_id, s.class_id, c.registration_fee, c.bus_fee, c.internship_fee, c.remedial_fee, c.tuition_fee, c.pta_fee FROM students s JOIN classes c ON s.class_id = c.id WHERE s.id = $1",
      [studentId]
    );
    if (sRes.rows.length === 0) {
      return res.status(404).json({ error: "Student not found" });
    }

    const srow = sRes.rows[0];
    const keyMap = {
      registration: "registration_fee",
      bus: "bus_fee",
      internship: "internship_fee",
      remedial: "remedial_fee",
      tuition: "tuition_fee",
      pta: "pta_fee",
    };
    const ft = String(fee_type || "")
      .trim()
      .toLowerCase();
    const feeKey = keyMap[ft];
    if (!feeKey) return res.status(400).json({ error: "Invalid fee type" });

    const expected =
      parseFloat(String(srow[feeKey] || "0").replace(/,/g, "")) || 0;
    if (desiredTotal > expected) {
      return res
        .status(400)
        .json({
          error: `Desired total exceeds expected for ${fee_type}`,
          expected,
        });
    }

    const sumRes = await pool.query(
      "SELECT COALESCE(SUM(amount),0) as paid FROM fees WHERE student_id = $1 AND LOWER(fee_type) = LOWER($2)",
      [studentId, fee_type]
    );
    const oldTotal = parseFloat(sumRes.rows[0].paid) || 0;

    // Start transaction
    await pool.query("BEGIN");

    // Delete existing payments for this student + fee_type
    await pool.query(
      "DELETE FROM fees WHERE student_id = $1 AND LOWER(fee_type) = LOWER($2)",
      [studentId, fee_type]
    );

    // Insert a single consolidated record if desiredTotal > 0
    if (desiredTotal > 0) {
      await pool.query(
        "INSERT INTO fees (student_id, class_id, fee_type, amount) VALUES ($1, $2, $3, $4)",
        [studentId, srow.class_id, fee_type, desiredTotal]
      );
    }

    await pool.query("COMMIT");

    try {
      const ipAddress = getIpAddress(req);
      const userAgent = getUserAgent(req);
      await logUserActivity(
        userId,
        "update",
        `Reconciled ${fee_type} to ${desiredTotal}`,
        "fees",
        studentId,
        fee_type,
        ipAddress,
        userAgent
      );
    } catch (logErr) {
      console.warn("Non-critical: failed to log reconcile activity", logErr);
    }

    const fieldsChanged = {
      fee_type: { before: fee_type, after: fee_type },
      total_amount: { before: oldTotal, after: desiredTotal },
    };
    await logChanges(
      "fees",
      studentId,
      ChangeTypes.update,
      req.user,
      fieldsChanged
    );
    return res.json({
      message: "Fee reconciled successfully",
      student_id: studentId,
      fee_type,
      total_amount: desiredTotal,
    });
  } catch (error) {
    await pool.query("ROLLBACK").catch(() => {});
    console.error("Error reconciling fee total:", error);
    return res
      .status(500)
      .json({ error: "Error reconciling fee total", details: error.message });
  }
});

// Get class fee stats
router.get("/class/:classId", authenticateToken, async (req, res) => {
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
      return res
        .status(404)
        .json({ error: `Class with ID ${classId} not found` });
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
        const query = `SELECT student_id, fee_type, SUM(amount) as paid FROM fees WHERE student_id IN (${placeholders}) AND EXTRACT(YEAR FROM paid_at) = $${
          studentIds.length + 1
        } GROUP BY student_id, fee_type`;
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

    // Calculate stats for each student (centralized status — Point 4D)
    const academicYearId = await getActiveAcademicYearId();
    const discountMap = await fetchDiscountMap(studentIds, academicYearId);

    const stats = students.map((student) => {
      const studentFees = feeMap[student.id] || {};
      const payload = buildStudentFeePayload(student, studentFees, discountMap[student.id]);
      return {
        id: student.id,
        student_id: student.student_code,
        full_name: student.full_name,
        balance: payload.balance,
        summary: payload.summary,
        total_expected: payload.summary.netExpected,
        total_paid: payload.summary.totalPaid,
        total_balance: payload.summary.totalBalance,
        status: payload.summary.status,
        paid_fees: studentFees,
      };
    });

    res.json(stats);
  } catch (error) {
    console.error("Error in /api/fees/class/:classId:", error);
    res.status(500).json({ error: "Failed to fetch class fee stats" });
  }
});

// Delete payment record
router.delete("/payments/:id", authenticateToken, async (req, res) => {
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

    await logChanges("fees", paymentId, ChangeTypes.delete, req.user);
    res.json({ message: "Payment record deleted successfully" });
  } catch (error) {
    console.error("Error deleting payment record:", error);
    res
      .status(500)
      .json({ error: "Error deleting payment record", details: error.message });
  }
});

// Clear all fees for a specific student
router.delete("/student/:studentId", authenticateToken, async (req, res) => {
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

    await logChanges("fees", studentId, ChangeTypes.delete, req.user);
    res.json({
      message: `Successfully cleared ${deletedCount} fee records for student: ${studentName}`,
      deletedCount,
      studentName,
    });
  } catch (error) {
    console.error("Error clearing student fees:", error);
    res
      .status(500)
      .json({ error: "Error clearing student fees", details: error.message });
  }
});

// Get individual payment details for a specific student
router.get(
  "/payments/student/:studentId",
  authenticateToken,
  async (req, res) => {
    const userId = req.user.id;
    const userRole = req.user.role;
    const studentId = req.params.studentId;

    try {
      let result;
      if (isAdminLike(userRole)) {
        // Admins can view all payment details
        result = await pool.query(
          `
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
      `,
          [studentId]
        );
      } else {
        // Regular users can only view their own students' payment details
        result = await pool.query(
          `
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
      `,
          [studentId, userId]
        );
      }
      res.json(result.rows);
    } catch (error) {
      console.error("Error fetching student payment details:", error);
      res
        .status(500)
        .json({
          error: "Error fetching student payment details",
          details: error.message,
        });
    }
  }
);

// --- Point 4C: Student fee discounts (persisted per student) ---

router.get("/students-with-discounts", authenticateToken, async (req, res) => {
  if (!requireAdminFinance(req, res)) return;
  try {
    const academicYearId = await getActiveAcademicYearId();
    if (!academicYearId) {
      return res.json([]);
    }
    const result = await pool.query(
      `
      SELECT
        d.id,
        d.student_id,
        d.academic_year_id,
        d.discount_amount,
        d.reason,
        d.set_by,
        d.created_at,
        d.updated_at,
        s.full_name AS student_name,
        s.student_id AS student_number,
        c.name AS class_name
      FROM student_fee_discounts d
      JOIN students s ON s.id = d.student_id
      LEFT JOIN classes c ON c.id = s.class_id
      WHERE d.academic_year_id = $1
        AND d.discount_amount > 0
        AND s."deletedAt" IS NULL
      ORDER BY s.full_name ASC
    `,
      [academicYearId]
    );
    res.json(result.rows);
  } catch (error) {
    console.error("Error fetching students with discounts:", error);
    res.status(500).json({ error: "Failed to fetch discounts", details: error.message });
  }
});

router.get("/discount/:studentId", authenticateToken, async (req, res) => {
  if (!requireAdminFinance(req, res)) return;
  const studentId = parseInt(req.params.studentId, 10);
  if (!Number.isInteger(studentId)) {
    return res.status(400).json({ error: "Invalid student id" });
  }
  try {
    const academicYearId = await getActiveAcademicYearId();
    if (!academicYearId) {
      return res.json({ student_id: studentId, discount_amount: 0, reason: null });
    }
    const discountRow = await fetchDiscountForStudent(studentId, academicYearId);
    res.json({
      student_id: studentId,
      academic_year_id: academicYearId,
      discount_amount: parseFeeAmount(discountRow?.discount_amount),
      reason: discountRow?.reason || null,
      id: discountRow?.id || null,
    });
  } catch (error) {
    console.error("Error fetching student discount:", error);
    res.status(500).json({ error: "Failed to fetch discount", details: error.message });
  }
});

router.put("/discount/:studentId", authenticateToken, async (req, res) => {
  if (!requireAdminFinance(req, res)) return;
  const studentId = parseInt(req.params.studentId, 10);
  if (!Number.isInteger(studentId)) {
    return res.status(400).json({ error: "Invalid student id" });
  }

  const { discount_amount, reason } = req.body || {};
  const amount = parseFeeAmount(discount_amount);
  if (amount < 0) {
    return res.status(400).json({ error: "discount_amount must be >= 0" });
  }

  try {
    const academicYearId = await getActiveAcademicYearId();
    if (!academicYearId) {
      return res.status(400).json({ error: "No active academic year configured" });
    }

    const studentRes = await pool.query(
      `SELECT s.*, c.registration_fee, c.bus_fee, c.internship_fee, c.remedial_fee, c.tuition_fee, c.pta_fee
       FROM students s
       JOIN classes c ON c.id = s.class_id
       WHERE s.id = $1 AND s."deletedAt" IS NULL`,
      [studentId]
    );
    if (!studentRes.rows.length) {
      return res.status(404).json({ error: "Student not found" });
    }

    const baseFee = computeBaseFee(studentRes.rows[0]);
    const warning =
      amount > baseFee
        ? "Discount exceeds total class fees; net due will be zero."
        : null;

    let discountRow;
    if (amount === 0) {
      await pool.query(
        `DELETE FROM student_fee_discounts
         WHERE student_id = $1 AND academic_year_id = $2`,
        [studentId, academicYearId]
      );
      discountRow = null;
    } else {
      const upsert = await pool.query(
        `
        INSERT INTO student_fee_discounts (
          student_id, academic_year_id, discount_amount, reason, set_by, updated_at
        ) VALUES ($1, $2, $3, $4, $5, NOW())
        ON CONFLICT (student_id, academic_year_id)
        DO UPDATE SET
          discount_amount = EXCLUDED.discount_amount,
          reason = EXCLUDED.reason,
          set_by = EXCLUDED.set_by,
          updated_at = NOW()
        RETURNING *
      `,
        [studentId, academicYearId, amount, reason || null, req.user.id]
      );
      discountRow = upsert.rows[0];
    }

    const feesRes = await pool.query(
      `SELECT fee_type, SUM(amount) AS paid FROM fees WHERE student_id = $1 GROUP BY fee_type`,
      [studentId]
    );
    const feeMap = Object.fromEntries(
      feesRes.rows.map((f) => [f.fee_type, parseFloat(f.paid)])
    );
    const payload = buildStudentFeePayload(
      studentRes.rows[0],
      feeMap,
      discountRow
    );

    res.json({
      message: amount === 0 ? "Discount cleared" : "Discount saved",
      warning,
      discount: discountRow
        ? {
            id: discountRow.id,
            student_id: discountRow.student_id,
            academic_year_id: discountRow.academic_year_id,
            discount_amount: parseFeeAmount(discountRow.discount_amount),
            reason: discountRow.reason,
          }
        : { student_id: studentId, discount_amount: 0, reason: null },
      feeStats: payload,
    });
  } catch (error) {
    console.error("Error saving student discount:", error);
    res.status(500).json({ error: "Failed to save discount", details: error.message });
  }
});

module.exports = router;
