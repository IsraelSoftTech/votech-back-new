"use strict";

const { FEE_TYPES } = require("./feeCalculation.service");

const FEE_TYPE_COLUMNS = {
  Registration: "registration_fee",
  Bus: "bus_fee",
  Tuition: "tuition_fee",
  Internship: "internship_fee",
  Remedial: "remedial_fee",
  PTA: "pta_fee",
};

const alias = (type) => `paid_${type.toLowerCase()}`;

// Class fee columns are VARCHAR and may hold values like "100 000 XAF".
const charged = (type) =>
  `COALESCE(NULLIF(REGEXP_REPLACE(TRIM(c.${FEE_TYPE_COLUMNS[type]}), '[^0-9.]', '', 'g'), '')::numeric, 0)`;

const BASE_FEE = FEE_TYPES.map(charged).join(" + ");

// Mirrors computePerTypeBalances(): money paid under one fee type never
// settles another, so each type is credited only up to what it charges.
const CREDITED_PAID = FEE_TYPES.map(
  (type) => `LEAST(COALESCE(p.${alias(type)}, 0), ${charged(type)})`
).join(" + ");

// LEAST() ignores NULL arguments in Postgres, so the discount has to be
// COALESCEd to 0 *before* LEAST. Written the other way round, a student with
// no discount row gets LEAST(NULL, base_fee) = base_fee — a silent 100%
// discount that zeroes out the whole school's expected fees.
const NET_EXPECTED = `GREATEST(0, (${BASE_FEE}) - LEAST(COALESCE(d.discount_amount, 0), (${BASE_FEE})))`;

const OWED = `GREATEST(0, ps.net_expected - ps.credited_paid)`;

const PAID_BY_TYPE_CTE = `
    paid_by_type AS (
      SELECT
        f.student_id,
        COALESCE(SUM(f.amount), 0) AS paid,
        ${FEE_TYPES.map(
          (type) =>
            `COALESCE(SUM(CASE WHEN f.fee_type = '${type}' THEN f.amount ELSE 0 END), 0) AS ${alias(
              type
            )}`
        ).join(",\n        ")}
      FROM fees f
      WHERE f.academic_year_id = $1
      GROUP BY f.student_id
    )`;

/**
 * One row per non-deleted student: what they are expected to pay for the
 * given academic year (after any discount), what they have paid, and how
 * much of that payment actually counts against what they were charged.
 * $1 = academic year id, $2 = user id (only when scoped).
 */
function perStudentCte(scopedToUser) {
  return `${PAID_BY_TYPE_CTE},
    per_student AS (
      SELECT
        s.id,
        c.id AS class_id,
        ${NET_EXPECTED} AS net_expected,
        (${CREDITED_PAID}) AS credited_paid,
        COALESCE(p.paid, 0) AS paid
      FROM students s
      LEFT JOIN classes c ON s.class_id = c.id
      LEFT JOIN paid_by_type p ON p.student_id = s.id
      LEFT JOIN student_fee_discounts d
        ON d.student_id = s.id AND d.academic_year_id = $1
      WHERE s."deletedAt" IS NULL AND s.academic_year_id = $1${scopedToUser ? " AND s.user_id = $2" : ""}
    )`;
}

function queryParams(academicYearId, userId) {
  return userId != null ? [academicYearId, userId] : [academicYearId];
}

/**
 * School-wide (or single-parent) fee totals. Owed is summed per student so
 * one family's overpayment can never mask another family's debt.
 */
async function fetchFeeTotals(pool, { academicYearId, userId = null }) {
  const { rows } = await pool.query(
    `WITH ${perStudentCte(userId != null)}
     SELECT
       COALESCE(SUM(ps.net_expected), 0) AS total_expected,
       COALESCE(SUM(ps.paid), 0) AS total_paid,
       COALESCE(SUM(${OWED}), 0) AS total_owed,
       COUNT(*) FILTER (WHERE ${OWED} > 0)::int AS students_owing
     FROM per_student ps`,
    queryParams(academicYearId, userId)
  );

  const row = rows[0] || {};
  return {
    totalExpected: parseFloat(row.total_expected) || 0,
    totalPaid: parseFloat(row.total_paid) || 0,
    totalOwed: parseFloat(row.total_owed) || 0,
    studentsOwing: row.students_owing || 0,
  };
}

/** Same figures broken down per class. Classes with no students are kept. */
async function fetchFeeTotalsByClass(pool, { academicYearId, userId = null }) {
  const { rows } = await pool.query(
    `WITH ${perStudentCte(userId != null)}
     SELECT
       c.id AS class_id,
       c.name AS class_name,
       COUNT(ps.id)::int AS student_count,
       COALESCE(SUM(ps.net_expected), 0) AS total_expected,
       COALESCE(SUM(ps.paid), 0) AS total_paid,
       COALESCE(SUM(${OWED}), 0) AS total_owed
     FROM classes c
     LEFT JOIN per_student ps ON ps.class_id = c.id
     GROUP BY c.id, c.name
     ORDER BY c.name`,
    queryParams(academicYearId, userId)
  );

  return rows.map((row) => ({
    class_id: row.class_id,
    class_name: row.class_name,
    student_count: row.student_count || 0,
    total_expected: parseFloat(row.total_expected) || 0,
    total_paid: parseFloat(row.total_paid) || 0,
    total_owed: parseFloat(row.total_owed) || 0,
  }));
}

async function fetchMonthlyPayments(pool, { userId = null }) {
  const scoped = userId != null;
  const sql = scoped
    ? `SELECT date_trunc('month', f.paid_at) AS month_start,
              COALESCE(SUM(f.amount), 0) AS paid
       FROM fees f
       INNER JOIN students s ON s.id = f.student_id AND s."deletedAt" IS NULL AND s.user_id = $1
       WHERE f.paid_at IS NOT NULL
       GROUP BY date_trunc('month', f.paid_at)
       ORDER BY month_start`
    : `SELECT date_trunc('month', f.paid_at) AS month_start,
              COALESCE(SUM(f.amount), 0) AS paid
       FROM fees f
       INNER JOIN students s ON s.id = f.student_id AND s."deletedAt" IS NULL
       WHERE f.paid_at IS NOT NULL
       GROUP BY date_trunc('month', f.paid_at)
       ORDER BY month_start`;
  const { rows } = await pool.query(sql, scoped ? [userId] : []);
  return rows;
}

function toFeeChart(monthlyRows, totals) {
  const expected = totals.totalExpected || 0;
  const fmt = new Intl.DateTimeFormat("en-GB", {
    month: "short",
    year: "numeric",
  });
  let cumulative = 0;
  const chart = (monthlyRows || []).map((row) => {
    cumulative += parseFloat(row.paid) || 0;
    const d = row.month_start ? new Date(row.month_start) : new Date();
    return {
      date: fmt.format(d),
      paid: cumulative,
      owed: Math.max(0, expected - cumulative),
    };
  });
  if (!chart.length) {
    return [
      {
        date: "Current",
        paid: totals.totalPaid || 0,
        owed: totals.totalOwed || 0,
      },
    ];
  }
  return chart;
}

/** Totals plus a monthly paid/owed series — one round-trip for Fee Overview. */
async function fetchFeeTotalsWithChart(pool, opts) {
  const [totals, monthly] = await Promise.all([
    fetchFeeTotals(pool, opts),
    fetchMonthlyPayments(pool, opts),
  ]);
  return { ...totals, chart: toFeeChart(monthly, totals) };
}

module.exports = {
  fetchFeeTotals,
  fetchFeeTotalsByClass,
  fetchFeeTotalsWithChart,
};
