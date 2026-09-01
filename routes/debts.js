const express = require("express");
const { pool, authenticateToken } = require("./utils");

const router = express.Router();

const FINANCE_ROLES = ["Admin1", "Admin2", "Admin3"];
const DEBT_TYPES = ["owed_by_school", "owed_to_school"];
const DEBT_STATUSES = ["open", "partial", "paid", "written_off"];

function requireFinanceAccess(req, res, next) {
  if (!FINANCE_ROLES.includes(req.user?.role)) {
    return res.status(403).json({ error: "Access denied. Finance admin only." });
  }
  next();
}

function roundMoney(value) {
  return Math.round(parseFloat(value || 0) * 100) / 100;
}

function computeBalance(amount, amountPaid) {
  return Math.max(0, roundMoney(amount) - roundMoney(amountPaid));
}

function deriveStatus(amount, amountPaid, currentStatus) {
  if (currentStatus === "written_off") return "written_off";
  const balance = computeBalance(amount, amountPaid);
  const paid = roundMoney(amountPaid);
  if (balance <= 0 && paid > 0) return "paid";
  if (paid > 0 && balance > 0) return "partial";
  return "open";
}

function mapDebtRow(row) {
  if (!row) return null;
  return {
    ...row,
    amount: roundMoney(row.amount),
    amount_paid: roundMoney(row.amount_paid),
    balance: roundMoney(row.balance),
  };
}

async function getActiveAcademicYearId() {
  const result = await pool.query(`
    SELECT id FROM "academicYears"
    WHERE status = 'active' AND "deletedAt" IS NULL
    ORDER BY id DESC
    LIMIT 1
  `);
  if (!result.rows.length) {
    const err = new Error("No active academic year is configured");
    err.status = 400;
    throw err;
  }
  return result.rows[0].id;
}

async function resolveAcademicYearId(academicYearId, { required = false } = {}) {
  if (academicYearId == null || academicYearId === "") {
    if (required) {
      return getActiveAcademicYearId();
    }
    return null;
  }
  const id = Number(academicYearId);
  if (!Number.isInteger(id) || id <= 0) {
    const err = new Error("Invalid academic year selected");
    err.status = 400;
    throw err;
  }
  const result = await pool.query(
    `SELECT id FROM "academicYears" WHERE id = $1 AND "deletedAt" IS NULL`,
    [id]
  );
  if (!result.rows.length) {
    const err = new Error("Selected academic year was not found");
    err.status = 400;
    throw err;
  }
  return id;
}

function buildListQuery(filters) {
  const { type, status, from, to, search, academic_year_id } = filters;
  const conditions = ["d.deleted_at IS NULL"];
  const params = [];
  let idx = 1;

  if (type) {
    conditions.push(`d.type = $${idx++}`);
    params.push(type);
  }
  if (status) {
    conditions.push(`d.status = $${idx++}`);
    params.push(status);
  }
  if (from) {
    conditions.push(`d.date_recorded >= $${idx++}`);
    params.push(from);
  }
  if (to) {
    conditions.push(`d.date_recorded <= $${idx++}`);
    params.push(to);
  }
  if (academic_year_id) {
    conditions.push(`d.academic_year_id = $${idx++}`);
    params.push(Number(academic_year_id));
  }
  if (search) {
    conditions.push(
      `(d.party_name ILIKE $${idx} OR d.reference_number ILIKE $${idx} OR COALESCE(d.description, '') ILIKE $${idx})`
    );
    params.push(`%${search}%`);
    idx += 1;
  }

  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  return { where, params };
}

const DEBT_SELECT = `
  SELECT
    d.*,
    ay.name AS academic_year_name,
    u.username AS created_by_name
  FROM debts d
  LEFT JOIN "academicYears" ay ON ay.id = d.academic_year_id AND ay."deletedAt" IS NULL
  LEFT JOIN users u ON u.id = d.created_by
`;

router.get("/summary", authenticateToken, requireFinanceAccess, async (req, res) => {
  try {
    const { from, to } = req.query;
    const { where, params } = buildListQuery({ from, to });

    const result = await pool.query(
      `
      SELECT
        d.type,
        COUNT(*)::int AS record_count,
        COALESCE(SUM(d.amount), 0) AS total_amount,
        COALESCE(SUM(d.amount_paid), 0) AS total_paid,
        COALESCE(SUM(d.balance), 0) AS total_balance,
        COUNT(*) FILTER (WHERE d.status IN ('open', 'partial'))::int AS open_count
      FROM debts d
      ${where}
      GROUP BY d.type
      `,
      params
    );

    const summary = {
      owed_by_school: {
        record_count: 0,
        total_amount: 0,
        total_paid: 0,
        total_balance: 0,
        open_count: 0,
      },
      owed_to_school: {
        record_count: 0,
        total_amount: 0,
        total_paid: 0,
        total_balance: 0,
        open_count: 0,
      },
    };

    for (const row of result.rows) {
      summary[row.type] = {
        record_count: row.record_count,
        total_amount: roundMoney(row.total_amount),
        total_paid: roundMoney(row.total_paid),
        total_balance: roundMoney(row.total_balance),
        open_count: row.open_count,
      };
    }

    res.json(summary);
  } catch (err) {
    console.error("GET /debts/summary error:", err);
    res.status(500).json({ error: "Failed to fetch debt summary" });
  }
});

router.get("/", authenticateToken, requireFinanceAccess, async (req, res) => {
  try {
    const { where, params } = buildListQuery(req.query);
    const result = await pool.query(
      `
      ${DEBT_SELECT}
      ${where}
      ORDER BY d.date_recorded DESC, d.id DESC
      `,
      params
    );
    res.json(result.rows.map(mapDebtRow));
  } catch (err) {
    console.error("GET /debts error:", err);
    res.status(500).json({ error: "Failed to fetch debts" });
  }
});

router.get("/:id", authenticateToken, requireFinanceAccess, async (req, res) => {
  try {
    const result = await pool.query(
      `
      ${DEBT_SELECT}
      WHERE d.id = $1 AND d.deleted_at IS NULL
      `,
      [req.params.id]
    );
    if (!result.rows.length) {
      return res.status(404).json({ error: "Debt record not found" });
    }
    res.json(mapDebtRow(result.rows[0]));
  } catch (err) {
    console.error("GET /debts/:id error:", err);
    res.status(500).json({ error: "Failed to fetch debt record" });
  }
});

router.post("/", authenticateToken, requireFinanceAccess, async (req, res) => {
  try {
    const {
      type,
      party_name,
      amount,
      currency = "XAF",
      description,
      reference_number,
      date_recorded,
      due_date,
      academic_year_id,
      status,
    } = req.body;

    if (!type || !DEBT_TYPES.includes(type)) {
      return res.status(400).json({ error: "Valid debt type is required" });
    }
    if (!party_name || !String(party_name).trim()) {
      return res.status(400).json({ error: "Party name is required" });
    }

    const debtAmount = roundMoney(amount);
    if (!debtAmount || debtAmount <= 0) {
      return res.status(400).json({ error: "Amount must be greater than zero" });
    }

    const initialStatus =
      status === "written_off" ? "written_off" : "open";
    const amountPaid = 0;
    const balance =
      initialStatus === "written_off" ? 0 : computeBalance(debtAmount, amountPaid);

    const resolvedYearId = await resolveAcademicYearId(academic_year_id, {
      required: true,
    });

    const result = await pool.query(
      `
      INSERT INTO debts (
        type, party_name, amount, currency, description, reference_number,
        date_recorded, due_date, status, amount_paid, balance,
        academic_year_id, created_by
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
      RETURNING id
      `,
      [
        type,
        String(party_name).trim(),
        debtAmount,
        currency || "XAF",
        description || null,
        reference_number || null,
        date_recorded || new Date().toISOString().slice(0, 10),
        due_date || null,
        initialStatus,
        amountPaid,
        balance,
        resolvedYearId,
        req.user.id,
      ]
    );

    const created = await pool.query(
      `${DEBT_SELECT} WHERE d.id = $1`,
      [result.rows[0].id]
    );
    res.status(201).json(mapDebtRow(created.rows[0]));
  } catch (err) {
    console.error("POST /debts error:", err);
    res
      .status(err.status || 500)
      .json({ error: err.message || "Failed to create debt record" });
  }
});

router.put("/:id", authenticateToken, requireFinanceAccess, async (req, res) => {
  try {
    const existingResult = await pool.query(
      `SELECT * FROM debts WHERE id = $1 AND deleted_at IS NULL`,
      [req.params.id]
    );
    if (!existingResult.rows.length) {
      return res.status(404).json({ error: "Debt record not found" });
    }
    const existing = existingResult.rows[0];

    const {
      type,
      party_name,
      amount,
      currency,
      description,
      reference_number,
      date_recorded,
      due_date,
      academic_year_id,
      status,
    } = req.body;

    const nextType = type && DEBT_TYPES.includes(type) ? type : existing.type;
    const nextParty =
      party_name != null && String(party_name).trim()
        ? String(party_name).trim()
        : existing.party_name;
    const nextAmount =
      amount != null ? roundMoney(amount) : roundMoney(existing.amount);
    if (nextAmount <= 0) {
      return res.status(400).json({ error: "Amount must be greater than zero" });
    }

    let nextAmountPaid = roundMoney(existing.amount_paid);
    if (nextAmountPaid > nextAmount) {
      nextAmountPaid = nextAmount;
    }

    let nextStatus = existing.status;
    if (status && DEBT_STATUSES.includes(status)) {
      nextStatus = status;
      if (status === "written_off") {
        nextAmountPaid = nextAmount;
      }
    } else if (nextStatus !== "written_off") {
      nextStatus = deriveStatus(nextAmount, nextAmountPaid, nextStatus);
    }

    const nextBalance =
      nextStatus === "written_off"
        ? 0
        : computeBalance(nextAmount, nextAmountPaid);

    let nextAcademicYearId = existing.academic_year_id;
    if (academic_year_id !== undefined) {
      nextAcademicYearId = await resolveAcademicYearId(academic_year_id);
    }

    const result = await pool.query(
      `
      UPDATE debts SET
        type = $1,
        party_name = $2,
        amount = $3,
        currency = $4,
        description = $5,
        reference_number = $6,
        date_recorded = $7,
        due_date = $8,
        status = $9,
        amount_paid = $10,
        balance = $11,
        academic_year_id = $12,
        updated_at = NOW()
      WHERE id = $13 AND deleted_at IS NULL
      RETURNING id
      `,
      [
        nextType,
        nextParty,
        nextAmount,
        currency || existing.currency,
        description !== undefined ? description : existing.description,
        reference_number !== undefined
          ? reference_number
          : existing.reference_number,
        date_recorded || existing.date_recorded,
        due_date !== undefined ? due_date : existing.due_date,
        nextStatus,
        nextAmountPaid,
        nextBalance,
        nextAcademicYearId,
        req.params.id,
      ]
    );

    if (!result.rows.length) {
      return res.status(404).json({ error: "Debt record not found" });
    }

    const updated = await pool.query(
      `${DEBT_SELECT} WHERE d.id = $1`,
      [req.params.id]
    );
    res.json(mapDebtRow(updated.rows[0]));
  } catch (err) {
    console.error("PUT /debts/:id error:", err);
    res
      .status(err.status || 500)
      .json({ error: err.message || "Failed to update debt record" });
  }
});

router.patch(
  "/:id/payment",
  authenticateToken,
  requireFinanceAccess,
  async (req, res) => {
    try {
      const paymentAmount = roundMoney(req.body?.amount);
      if (!paymentAmount || paymentAmount <= 0) {
        return res
          .status(400)
          .json({ error: "Payment amount must be greater than zero" });
      }

      const existingResult = await pool.query(
        `SELECT * FROM debts WHERE id = $1 AND deleted_at IS NULL`,
        [req.params.id]
      );
      if (!existingResult.rows.length) {
        return res.status(404).json({ error: "Debt record not found" });
      }

      const existing = existingResult.rows[0];
      if (existing.status === "written_off") {
        return res
          .status(400)
          .json({ error: "Cannot record payment on a written-off debt" });
      }
      if (existing.status === "paid") {
        return res.status(400).json({ error: "Debt is already fully paid" });
      }

      const currentBalance = computeBalance(existing.amount, existing.amount_paid);
      if (paymentAmount > currentBalance) {
        return res.status(400).json({
          error: `Payment exceeds remaining balance (${currentBalance} XAF)`,
        });
      }

      const nextAmountPaid = roundMoney(existing.amount_paid + paymentAmount);
      const nextBalance = computeBalance(existing.amount, nextAmountPaid);
      const nextStatus = deriveStatus(
        existing.amount,
        nextAmountPaid,
        existing.status
      );

      await pool.query(
        `
        UPDATE debts SET
          amount_paid = $1,
          balance = $2,
          status = $3,
          updated_at = NOW()
        WHERE id = $4 AND deleted_at IS NULL
        `,
        [nextAmountPaid, nextBalance, nextStatus, req.params.id]
      );

      const updated = await pool.query(
        `${DEBT_SELECT} WHERE d.id = $1`,
        [req.params.id]
      );
      res.json(mapDebtRow(updated.rows[0]));
    } catch (err) {
      console.error("PATCH /debts/:id/payment error:", err);
      res.status(500).json({ error: "Failed to record payment" });
    }
  }
);

router.delete(
  "/:id",
  authenticateToken,
  requireFinanceAccess,
  async (req, res) => {
    try {
      const result = await pool.query(
        `
        UPDATE debts
        SET deleted_at = NOW(), updated_at = NOW()
        WHERE id = $1 AND deleted_at IS NULL
        RETURNING id
        `,
        [req.params.id]
      );
      if (!result.rows.length) {
        return res.status(404).json({ error: "Debt record not found" });
      }
      res.json({ success: true, id: result.rows[0].id });
    } catch (err) {
      console.error("DELETE /debts/:id error:", err);
      res.status(500).json({ error: "Failed to delete debt record" });
    }
  }
);

module.exports = router;
