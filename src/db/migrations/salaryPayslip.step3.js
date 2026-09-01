"use strict";

/**
 * Point 4B — Repair orphaned salary rows (user_id cleared by legacy bulk update / sync).
 * Bulk insert used 12 consecutive ids per employee. Match orphans to siblings with same
 * amount in the same id block when the id-1 row is missing.
 */
async function run(pool, label = "salary payslip step 3 repair orphans") {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const applyEmployeeSnapshot = `
      employee_name = COALESCE(
        NULLIF(TRIM(m.employee_name), ''),
        NULLIF(TRIM(t.full_name), ''),
        NULLIF(TRIM(u.name), ''),
        NULLIF(TRIM(u.username), '')
      ),
      employee_contact = COALESCE(
        NULLIF(TRIM(m.employee_contact), ''),
        NULLIF(TRIM(t.contact), ''),
        NULLIF(TRIM(u.contact), ''),
        NULLIF(TRIM(u.email), '')
      ),
      employee_classes = COALESCE(
        NULLIF(TRIM(m.employee_classes), ''),
        NULLIF(TRIM(t.classes), '')
      ),
      employee_subjects = COALESCE(
        NULLIF(TRIM(m.employee_subjects), ''),
        NULLIF(TRIM(t.subjects), '')
      ),
      updated_at = CURRENT_TIMESTAMP
    `;

    // 1) Direct predecessor (March → February in same batch)
    const consecutive = await client.query(`
      UPDATE salaries m
      SET
        user_id = s.user_id,
        ${applyEmployeeSnapshot}
      FROM salaries s
      JOIN users u ON u.id = s.user_id
      LEFT JOIN teachers t ON t.user_id = u.id
      WHERE m.user_id IS NULL
        AND m.paid = true
        AND s.id = m.id - 1
        AND s.user_id IS NOT NULL
        AND s.year = m.year
        AND s.amount = m.amount
        AND m.month <> 'January'
    `);

    // 2) January orphans → December sibling (id + 11 in same batch)
    const january = await client.query(`
      UPDATE salaries m
      SET
        user_id = s.user_id,
        ${applyEmployeeSnapshot}
      FROM salaries s
      JOIN users u ON u.id = s.user_id
      LEFT JOIN teachers t ON t.user_id = u.id
      WHERE m.user_id IS NULL
        AND m.paid = true
        AND m.month = 'January'
        AND s.id = m.id + 11
        AND s.user_id IS NOT NULL
        AND s.year = m.year
        AND s.amount = m.amount
        AND s.month = 'December'
    `);

    // 3) Fallback: unique sibling in same 12-record batch (same amount + year)
    const batchFallback = await client.query(`
      WITH candidates AS (
        SELECT
          m.id AS orphan_id,
          s.user_id,
          ABS(s.id - m.id) AS distance
        FROM salaries m
        JOIN salaries s
          ON s.id <> m.id
         AND s.user_id IS NOT NULL
         AND s.year = m.year
         AND s.amount = m.amount
         AND s.id BETWEEN m.id - 11 AND m.id + 11
        WHERE m.user_id IS NULL
          AND m.paid = true
      ),
      unique_orphans AS (
        SELECT orphan_id
        FROM candidates
        GROUP BY orphan_id
        HAVING COUNT(DISTINCT user_id) = 1
      ),
      ranked AS (
        SELECT
          c.orphan_id,
          c.user_id,
          ROW_NUMBER() OVER (PARTITION BY c.orphan_id ORDER BY c.distance) AS rn
        FROM candidates c
        JOIN unique_orphans uo ON uo.orphan_id = c.orphan_id
      ),
      picks AS (
        SELECT orphan_id, user_id
        FROM ranked
        WHERE rn = 1
      )
      UPDATE salaries m
      SET
        user_id = p.user_id,
        ${applyEmployeeSnapshot}
      FROM picks p
      JOIN users u ON u.id = p.user_id
      LEFT JOIN teachers t ON t.user_id = u.id
      WHERE m.id = p.orphan_id
        AND m.user_id IS NULL
    `);

    const remaining = await client.query(`
      SELECT COUNT(*)::int AS cnt
      FROM salaries
      WHERE paid = true AND user_id IS NULL
    `);

    await client.query("COMMIT");
    console.log(
      `✅ ${label}: consecutive=${consecutive.rowCount}, january=${january.rowCount}, batch=${batchFallback.rowCount}, remaining_orphans=${remaining.rows[0].cnt}`
    );
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { run };
