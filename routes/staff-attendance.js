const express = require("express");
const moment = require("moment");

const { ChangeTypes, logChanges } = require("../src/utils/logChanges.util");

module.exports = function createStaffAttendanceRouter(pool, authenticateToken) {
  const router = express.Router();

  // Test endpoint to check database connection and table
  router.get("/test", authenticateToken, async (req, res) => {
    try {
      console.log("Testing database connection and table...");

      // Test basic connection
      const connectionTest = await pool.query("SELECT NOW() as current_time");
      console.log("Database connection successful:", connectionTest.rows[0]);

      // Test table existence
      const tableTest = await pool.query(`
        SELECT EXISTS (
          SELECT FROM information_schema.tables 
          WHERE table_schema = 'public' 
          AND table_name = 'staff_attendance_records'
        );
      `);
      console.log("Table exists:", tableTest.rows[0].exists);

      // Test table structure
      const structureTest = await pool.query(`
        SELECT column_name, data_type, is_nullable 
        FROM information_schema.columns 
        WHERE table_name = 'staff_attendance_records' 
        ORDER BY ordinal_position;
      `);
      console.log("Table structure:", structureTest.rows);

      // Check for unique constraints
      const constraintTest = await pool.query(`
        SELECT constraint_name, constraint_type 
        FROM information_schema.table_constraints 
        WHERE table_name = 'staff_attendance_records' 
        AND constraint_type = 'UNIQUE';
      `);
      console.log("Unique constraints:", constraintTest.rows);

      // Add unique constraint if it doesn't exist
      if (constraintTest.rows.length === 0) {
        console.log("Adding unique constraint...");
        try {
          await pool.query(`
            ALTER TABLE staff_attendance_records 
            ADD CONSTRAINT unique_staff_date UNIQUE (date, staff_name);
          `);
          console.log("Unique constraint added successfully");
        } catch (constraintError) {
          console.log(
            "Could not add unique constraint (may already exist):",
            constraintError.message
          );
        }
      }

      res.json({
        connection: "OK",
        tableExists: tableTest.rows[0].exists,
        tableStructure: structureTest.rows,
        uniqueConstraints: constraintTest.rows,
        currentTime: connectionTest.rows[0].current_time,
      });
    } catch (error) {
      console.error("Test endpoint error:", error);
      res.status(500).json({
        error: "Test failed",
        details: error.message,
      });
    }
  });

  // Get staff attendance statistics
  router.get("/stats", authenticateToken, async (req, res) => {
    try {
      const currentMonth = moment().format("YYYY-MM");
      const lastMonth = moment().subtract(1, "month").format("YYYY-MM");

      // Current month stats
      const currentMonthQuery = `
        SELECT 
          COUNT(*) as total_records,
          COUNT(CASE WHEN status = 'Present' THEN 1 END) as present_count,
          COUNT(CASE WHEN status = 'Absent' THEN 1 END) as absent_count,
          COUNT(CASE WHEN status = 'Late' THEN 1 END) as late_count,
          COUNT(CASE WHEN status = 'Half Day' THEN 1 END) as half_day_count
        FROM staff_attendance_records 
        WHERE TO_CHAR(date, 'YYYY-MM') = $1
      `;

      // Last month stats
      const lastMonthQuery = `
        SELECT 
          COUNT(*) as total_records,
          COUNT(CASE WHEN status = 'Present' THEN 1 END) as present_count,
          COUNT(CASE WHEN status = 'Absent' THEN 1 END) as absent_count,
          COUNT(CASE WHEN status = 'Late' THEN 1 END) as late_count,
          COUNT(CASE WHEN status = 'Half Day' THEN 1 END) as half_day_count
        FROM staff_attendance_records 
        WHERE TO_CHAR(date, 'YYYY-MM') = $1
      `;

      const [currentResult, lastResult] = await Promise.all([
        pool.query(currentMonthQuery, [currentMonth]),
        pool.query(lastMonthQuery, [lastMonth]),
      ]);

      const currentStats = currentResult.rows[0] || {
        total_records: 0,
        present_count: 0,
        absent_count: 0,
        late_count: 0,
        half_day_count: 0,
      };

      const lastStats = lastResult.rows[0] || {
        total_records: 0,
        present_count: 0,
        absent_count: 0,
        late_count: 0,
        half_day_count: 0,
      };

      // Calculate attendance rate
      const currentAttendanceRate =
        currentStats.total_records > 0
          ? Math.round(
              (currentStats.present_count / currentStats.total_records) * 100
            )
          : 0;

      const lastAttendanceRate =
        lastStats.total_records > 0
          ? Math.round(
              (lastStats.present_count / lastStats.total_records) * 100
            )
          : 0;

      res.json({
        currentMonth: {
          ...currentStats,
          attendanceRate: currentAttendanceRate,
          month: currentMonth,
        },
        lastMonth: {
          ...lastStats,
          attendanceRate: lastAttendanceRate,
          month: lastMonth,
        },
      });
    } catch (error) {
      console.error("Error fetching staff attendance stats:", error);
      res
        .status(500)
        .json({ error: "Failed to fetch staff attendance statistics" });
    }
  });

  // Get all users for staff selection
  router.get("/users", authenticateToken, async (req, res) => {
    try {
      const result = await pool.query(`
        SELECT id, username, name, role
        FROM users 
        WHERE role IN ('Admin', 'Admin2', 'Admin3', 'Teacher', 'HOD')
        ORDER BY name
      `);
      res.json(result.rows);
    } catch (error) {
      console.error("Error fetching users:", error);
      res.status(500).json({ error: "Failed to fetch users" });
    }
  });

  // Get all classes for selection
  router.get("/classes", authenticateToken, async (req, res) => {
    try {
      const result = await pool.query(`
        SELECT id, name
        FROM classes 
        WHERE suspended = FALSE
        ORDER BY name
      `);
      res.json(result.rows);
    } catch (error) {
      console.error("Error fetching classes:", error);
      res.status(500).json({ error: "Failed to fetch classes" });
    }
  });

  // Create new staff attendance record
  router.post("/records", authenticateToken, async (req, res) => {
    try {
      const { date, staff_name, time_in, time_out, classes_taught, status } =
        req.body;

      // Validate required fields
      if (!date || !staff_name || !status) {
        return res.status(400).json({
          error: "Date, staff name, and status are required",
        });
      }

      // Validate status
      const validStatuses = ["Present", "Absent", "Late", "Half Day"];
      if (!validStatuses.includes(status)) {
        return res.status(400).json({
          error: `Invalid status. Must be one of: ${validStatuses.join(", ")}`,
        });
      }

      const result = await pool.query(
        `
        INSERT INTO staff_attendance_records (date, staff_name, time_in, time_out, classes_taught, status)
        VALUES ($1, $2, $3, $4, $5, $6)
        RETURNING *
      `,
        [date, staff_name, time_in, time_out, classes_taught, status]
      );

      await logChanges(
        "staff_attendance_records",
        result.rows[0].id,
        ChangeTypes.create,
        req.user
      );
      res.status(201).json(result.rows[0]);
    } catch (error) {
      console.error("Error creating staff attendance record:", error);
      if (error.code === "23505") {
        // Unique constraint violation
        res.status(400).json({
          error: "A record for this staff member on this date already exists",
        });
      } else {
        res
          .status(500)
          .json({ error: "Failed to create staff attendance record" });
      }
    }
  });

  // Get all staff attendance records
  router.get("/records", authenticateToken, async (req, res) => {
    try {
      const { page = 1, limit = 50, month, year } = req.query;
      const offset = (page - 1) * limit;

      let whereClause = "";
      let queryParams = [];
      let paramCount = 0;

      if (month && year) {
        paramCount++;
        whereClause = `WHERE TO_CHAR(date, 'YYYY-MM') = $${paramCount}`;
        queryParams.push(`${year}-${month.padStart(2, "0")}`);
      }

      const query = `
        SELECT id, date, staff_name, time_in, time_out, classes_taught, status, created_at, updated_at
        FROM staff_attendance_records 
        ${whereClause}
        ORDER BY date DESC, staff_name ASC
        LIMIT $${paramCount + 1} OFFSET $${paramCount + 2}
      `;

      queryParams.push(limit, offset);

      const result = await pool.query(query, queryParams);
      res.json(result.rows);
    } catch (error) {
      console.error("Error fetching staff attendance records:", error);
      res
        .status(500)
        .json({ error: "Failed to fetch staff attendance records" });
    }
  });

  // Update staff attendance record
  router.put("/records/:id", authenticateToken, async (req, res) => {
    try {
      const { id } = req.params;
      const { date, staff_name, time_in, time_out, classes_taught, status } =
        req.body;

      // Validate status
      const validStatuses = ["Present", "Absent", "Late", "Half Day"];
      if (status && !validStatuses.includes(status)) {
        return res.status(400).json({
          error: `Invalid status. Must be one of: ${validStatuses.join(", ")}`,
        });
      }

      const oldRecord = await pool.query(
        "SELECT * FROM staff_attendance_records WHERE id = $1",
        [id]
      );
      if (oldRecord.rows.length === 0) {
        return res.status(404).json({ error: "Record not found" });
      }

      const result = await pool.query(
        `
        UPDATE staff_attendance_records 
        SET 
          date = COALESCE($1, date),
          staff_name = COALESCE($2, staff_name),
          time_in = COALESCE($3, time_in),
          time_out = COALESCE($4, time_out),
          classes_taught = COALESCE($5, classes_taught),
          status = COALESCE($6, status),
          updated_at = CURRENT_TIMESTAMP
        WHERE id = $7
        RETURNING *
      `,
        [date, staff_name, time_in, time_out, classes_taught, status, id]
      );

      if (result.rows.length === 0) {
        return res.status(404).json({ error: "Record not found" });
      }

      const fieldsChanged = {};
      const old = oldRecord.rows[0];
      const updated = result.rows[0];
      if (old.date !== updated.date)
        fieldsChanged.date = { before: old.date, after: updated.date };
      if (old.staff_name !== updated.staff_name)
        fieldsChanged.staff_name = {
          before: old.staff_name,
          after: updated.staff_name,
        };
      if (old.time_in !== updated.time_in)
        fieldsChanged.time_in = { before: old.time_in, after: updated.time_in };
      if (old.time_out !== updated.time_out)
        fieldsChanged.time_out = {
          before: old.time_out,
          after: updated.time_out,
        };
      if (old.classes_taught !== updated.classes_taught)
        fieldsChanged.classes_taught = {
          before: old.classes_taught,
          after: updated.classes_taught,
        };
      if (old.status !== updated.status)
        fieldsChanged.status = { before: old.status, after: updated.status };
      await logChanges(
        "staff_attendance_records",
        id,
        ChangeTypes.update,
        req.user,
        fieldsChanged
      );
      res.json(result.rows[0]);
    } catch (error) {
      console.error("Error updating staff attendance record:", error);
      res
        .status(500)
        .json({ error: "Failed to update staff attendance record" });
    }
  });

  // Delete staff attendance record
  router.delete("/records/:id", authenticateToken, async (req, res) => {
    try {
      const { id } = req.params;
      const result = await pool.query(
        "DELETE FROM staff_attendance_records WHERE id = $1 RETURNING *",
        [id]
      );

      if (result.rows.length === 0) {
        return res.status(404).json({ error: "Record not found" });
      }

      await logChanges(
        "staff_attendance_records",
        id,
        ChangeTypes.delete,
        req.user
      );
      res.json({ message: "Record deleted successfully" });
    } catch (error) {
      console.error("Error deleting staff attendance record:", error);
      res
        .status(500)
        .json({ error: "Failed to delete staff attendance record" });
    }
  });

  // Generate monthly report
  router.get("/monthly-report", authenticateToken, async (req, res) => {
    try {
      const { month, year } = req.query;

      if (!month || !year) {
        return res.status(400).json({ error: "Month and year are required" });
      }

      const targetMonth = `${year}-${month.padStart(2, "0")}`;

      // Get all records for the month
      const recordsQuery = `
        SELECT date, staff_name, time_in, time_out, classes_taught, status
        FROM staff_attendance_records 
        WHERE TO_CHAR(date, 'YYYY-MM') = $1
        ORDER BY date ASC, staff_name ASC
      `;

      const recordsResult = await pool.query(recordsQuery, [targetMonth]);
      const records = recordsResult.rows;

      // Get unique staff members
      const staffMembers = [...new Set(records.map((r) => r.staff_name))];

      // Get days in the month
      const daysInMonth = moment(targetMonth, "YYYY-MM").daysInMonth();
      const monthDays = Array.from({ length: daysInMonth }, (_, i) => i + 1);

      // Generate report data
      const reportData = staffMembers.map((staff) => {
        const staffRecords = records.filter((r) => r.staff_name === staff);
        const staffReport = {
          staff_name: staff,
          total_days: daysInMonth,
          present_days: 0,
          absent_days: 0,
          late_days: 0,
          half_days: 0,
          daily_records: {},
        };

        // Initialize all days as absent
        monthDays.forEach((day) => {
          staffReport.daily_records[day] = {
            date: `${day.toString().padStart(2, "0")}/${month.padStart(
              2,
              "0"
            )}/${year}`,
            status: "Absent",
            time_in: null,
            time_out: null,
            classes_taught: "",
          };
        });

        // Fill in actual records
        staffRecords.forEach((record) => {
          const day = moment(record.date).date();
          staffReport.daily_records[day] = {
            date: moment(record.date).format("DD/MM/YYYY"),
            status: record.status,
            time_in: record.time_in,
            time_out: record.time_out,
            classes_taught: record.classes_taught || "",
          };

          // Count status types
          switch (record.status) {
            case "Present":
              staffReport.present_days++;
              break;
            case "Absent":
              staffReport.absent_days++;
              break;
            case "Late":
              staffReport.late_days++;
              break;
            case "Half Day":
              staffReport.half_days++;
              break;
          }
        });

        // Calculate attendance rate
        staffReport.attendance_rate =
          staffReport.total_days > 0
            ? Math.round(
                (staffReport.present_days / staffReport.total_days) * 100
              )
            : 0;

        return staffReport;
      });

      // Calculate overall statistics
      const totalRecords = records.length;
      const totalPresent = records.filter((r) => r.status === "Present").length;
      const totalAbsent = records.filter((r) => r.status === "Absent").length;
      const totalLate = records.filter((r) => r.status === "Late").length;
      const totalHalfDays = records.filter(
        (r) => r.status === "Half Day"
      ).length;

      const overallAttendanceRate =
        totalRecords > 0 ? Math.round((totalPresent / totalRecords) * 100) : 0;

      const report = {
        month: targetMonth,
        month_name: moment(targetMonth, "YYYY-MM").format("MMMM YYYY"),
        total_staff: staffMembers.length,
        total_records: totalRecords,
        overall_stats: {
          present: totalPresent,
          absent: totalAbsent,
          late: totalLate,
          half_days: totalHalfDays,
          attendance_rate: overallAttendanceRate,
        },
        staff_reports: reportData,
        generated_at: new Date().toISOString(),
      };

      res.json(report);
    } catch (error) {
      console.error("Error generating monthly report:", error);
      res.status(500).json({ error: "Failed to generate monthly report" });
    }
  });

  return router;
};
