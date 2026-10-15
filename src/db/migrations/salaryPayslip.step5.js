"use strict";

/**
 * A salary belongs to one employee, one month, and one year.
 * salaries_user_id_month_key ignored the year, so September 2026
 * could not be saved once September 2025 already existed.
 */
async function run(pool, label = "salary payslip step 5 month-year uniqueness") {
  await pool.query(`
    ALTER TABLE salaries DROP CONSTRAINT IF EXISTS salaries_user_id_month_key
  `);
  await pool.query(`
    DROP INDEX IF EXISTS salaries_user_id_month_key
  `);
  console.log(`✅ ${label}: one salary per employee per month per year`);
}

module.exports = { run };
