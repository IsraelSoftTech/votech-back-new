const express = require("express");
const { pool, authenticateToken } = require("./utils");

const router = express.Router();

const { ChangeTypes, logChanges } = require("../src/utils/logChanges.util");

// Get financial summary
router.get("/summary", authenticateToken, async (req, res) => {
  try {
    const { start_date, end_date, type } = req.query;

    // Get income from fees (student payments)
    let feesIncomeQuery = `
      SELECT COALESCE(SUM(amount), 0) as total_income
      FROM fees
      WHERE 1=1
    `;

    // Get expenditure from inventory (expenditure type)
    let expenditureQuery = `
      SELECT COALESCE(SUM(estimated_cost), 0) as total_expenditure
      FROM inventory
      WHERE type = 'expenditure'
    `;

    // Get asset purchases from inventory (income type with asset category)
    let assetQuery = `
      SELECT COALESCE(SUM(estimated_cost), 0) as total_assets
      FROM inventory
      WHERE type = 'income' AND asset_category IS NOT NULL
    `;

    // Get salary data
    let salaryQuery = `
      SELECT 
        COALESCE(SUM(amount), 0) as total_expected,
        COALESCE(SUM(CASE WHEN paid = true THEN amount ELSE 0 END), 0) as total_paid
      FROM salaries
      WHERE 1=1
    `;

    // Get detailed fee breakdown
    let feeBreakdownQuery = `
      SELECT 
        fee_type,
        COALESCE(SUM(amount), 0) as total_amount,
        COUNT(*) as payment_count
      FROM fees
      WHERE 1=1
      GROUP BY fee_type
      ORDER BY total_amount DESC
    `;

    // Get class-wise fee totals
    let classFeeQuery = `
      SELECT 
        c.name as class_name,
        COALESCE(SUM(f.amount), 0) as total_fees_collected,
        COUNT(DISTINCT f.student_id) as students_paid,
        c.total_fee as class_total_fee
      FROM fees f
      JOIN students s ON f.student_id = s.id
      JOIN classes c ON s.class_id = c.id
      WHERE 1=1
      GROUP BY c.id, c.name, c.total_fee
      ORDER BY total_fees_collected DESC
    `;

    const params = [];
    let paramCount = 0;

    if (start_date) {
      paramCount++;
      feesIncomeQuery += ` AND paid_at >= $${paramCount}`;
      salaryQuery += ` AND created_at >= $${paramCount}`;
      feeBreakdownQuery += ` AND paid_at >= $${paramCount}`;
      classFeeQuery += ` AND f.paid_at >= $${paramCount}`;
      params.push(start_date);
    }

    if (end_date) {
      paramCount++;
      feesIncomeQuery += ` AND paid_at <= $${paramCount}`;
      salaryQuery += ` AND created_at <= $${paramCount}`;
      feeBreakdownQuery += ` AND paid_at <= $${paramCount}`;
      classFeeQuery += ` AND f.paid_at <= $${paramCount}`;
      params.push(end_date);
    }

    const [
      feesIncomeResult,
      expenditureResult,
      assetResult,
      salaryResult,
      feeBreakdownResult,
      classFeeResult,
    ] = await Promise.all([
      pool.query(feesIncomeQuery, params),
      pool.query(expenditureQuery, params),
      pool.query(assetQuery, params),
      pool.query(salaryQuery, params),
      pool.query(feeBreakdownQuery, params),
      pool.query(classFeeQuery, params),
    ]);

    const totalIncome = parseFloat(feesIncomeResult.rows[0]?.total_income || 0);
    const totalExpenditure = parseFloat(
      expenditureResult.rows[0]?.total_expenditure || 0
    );
    const totalAssets = parseFloat(assetResult.rows[0]?.total_assets || 0);
    const salaryExpected = parseFloat(
      salaryResult.rows[0]?.total_expected || 0
    );
    const salaryPaid = parseFloat(salaryResult.rows[0]?.total_paid || 0);
    const salaryOwed = salaryExpected - salaryPaid;

    // Calculate comprehensive totals
    const totalExpectedIncome = totalIncome + totalAssets; // Fees + Asset purchases
    const totalExpectedExpenditure = totalExpenditure + salaryExpected; // Inventory + Salaries
    const netIncome = totalIncome - totalExpenditure - salaryPaid;

    const summary = {
      // Core financial data
      total_income: totalIncome,
      total_expenditure: totalExpenditure,
      total_assets: totalAssets,
      net_income: netIncome,
      period_value:
        start_date && end_date ? `${start_date} to ${end_date}` : "All Time",

      // Fee reports
      fee_reports: {
        total_fees_collected: totalIncome,
        fee_breakdown: feeBreakdownResult.rows.map((row) => ({
          fee_type: row.fee_type,
          amount: parseFloat(row.total_amount),
          payment_count: parseInt(row.payment_count),
        })),
        class_wise_totals: classFeeResult.rows.map((row) => ({
          class_name: row.class_name,
          fees_collected: parseFloat(row.total_fees_collected),
          students_paid: parseInt(row.students_paid),
          class_total_fee: parseFloat(row.class_total_fee || 0),
        })),
      },

      // Salary reports
      salary_reports: {
        total_expected: salaryExpected,
        total_paid: salaryPaid,
        total_owed: salaryOwed,
        payment_percentage:
          salaryExpected > 0 ? (salaryPaid / salaryExpected) * 100 : 0,
      },

      // Comprehensive summary
      comprehensive_summary: {
        total_expected_income: totalExpectedIncome,
        total_expected_expenditure: totalExpectedExpenditure,
        net_worth: totalIncome - totalExpenditure - salaryPaid,
        financial_health:
          netIncome > 0
            ? "Positive"
            : netIncome === 0
            ? "Balanced"
            : "Negative",
      },
    };

    res.json(summary);
  } catch (error) {
    console.error("Error fetching financial summary:", error);
    res.status(500).json({ error: "Failed to fetch financial summary" });
  }
});

// Get balance sheet
router.get("/balance-sheet", authenticateToken, async (req, res) => {
  try {
    const { as_of_date } = req.query;

    // Get assets from inventory (equipment purchases)
    const assetsResult = await pool.query(`
      SELECT 
        COALESCE(SUM(estimated_cost), 0) as total_assets
      FROM inventory 
      WHERE type = 'income' AND asset_category IS NOT NULL
    `);

    // Get income from fees
    const incomeResult = await pool.query(`
      SELECT 
        COALESCE(SUM(amount), 0) as total_income
      FROM fees
    `);

    // Get expenditure from inventory (expenditure type)
    const expenditureResult = await pool.query(`
      SELECT 
        COALESCE(SUM(estimated_cost), 0) as total_expenditure
      FROM inventory 
      WHERE type = 'expenditure'
    `);

    const totalAssets = parseFloat(assetsResult.rows[0]?.total_assets || 0);
    const totalIncome = parseFloat(incomeResult.rows[0]?.total_income || 0);
    const totalExpenditure = parseFloat(
      expenditureResult.rows[0]?.total_expenditure || 0
    );
    const netWorth = totalIncome - totalExpenditure;

    const balanceSheet = {
      assets: {
        total_assets: totalAssets,
        current_assets: totalAssets,
        depreciation: 0,
      },
      liabilities: {
        total_liabilities: 0,
      },
      equity: {
        total_income: totalIncome,
        total_expenditure: totalExpenditure,
        net_worth: netWorth,
      },
      totals: {
        total_assets: totalAssets,
        total_liabilities: 0,
        total_equity: netWorth,
        liabilities_plus_equity: netWorth,
      },
      as_of_date: as_of_date || new Date().toISOString().split("T")[0],
    };

    res.json(balanceSheet);
  } catch (error) {
    console.error("Error fetching balance sheet:", error);
    res
      .status(500)
      .json({ error: "Failed to fetch balance sheet", details: error.message });
  }
});

// Calculate depreciation
router.post("/calculate-depreciation", authenticateToken, async (req, res) => {
  try {
    const { asset_id, depreciation_amount, depreciation_date } = req.body;

    const oldRecord = await pool.query(
      "SELECT * FROM inventory WHERE id = $1",
      [asset_id]
    );
    if (oldRecord.rows.length === 0) {
      return res.status(404).json({ error: "Asset not found" });
    }

    // Update asset book value
    await pool.query(
      `
      UPDATE inventory 
      SET book_value = book_value - $1, 
          accumulated_depreciation = accumulated_depreciation + $1
      WHERE id = $2
    `,
      [depreciation_amount, asset_id]
    );

    const updatedRecord = await pool.query(
      "SELECT * FROM inventory WHERE id = $1",
      [asset_id]
    );
    const fieldsChanged = {};
    const old = oldRecord.rows[0];
    const updated = updatedRecord.rows[0];
    if (old.book_value !== updated.book_value)
      fieldsChanged.book_value = {
        before: old.book_value,
        after: updated.book_value,
      };
    if (old.accumulated_depreciation !== updated.accumulated_depreciation)
      fieldsChanged.accumulated_depreciation = {
        before: old.accumulated_depreciation,
        after: updated.accumulated_depreciation,
      };
    await logChanges(
      "inventory",
      asset_id,
      ChangeTypes.update,
      req.user,
      fieldsChanged
    );

    // Record depreciation transaction
    const result = await pool.query(
      `
      INSERT INTO financial_transactions 
      (type, amount, description, transaction_date, related_asset_id) 
      VALUES ('depreciation', $1, 'Depreciation expense', $2, $3) 
      RETURNING *
    `,
      [depreciation_amount, depreciation_date, asset_id]
    );

    await logChanges(
      "financial_transactions",
      result.rows[0].id,
      ChangeTypes.create,
      req.user
    );
    res.json(result.rows[0]);
  } catch (error) {
    console.error("Error calculating depreciation:", error);
    res.status(500).json({ error: "Failed to calculate depreciation" });
  }
});

module.exports = router;
