"use strict";

/**
 * Backfill payslip class/subject snapshots from teacher_assignments
 * (teachers table is empty in production; assignments hold the real data).
 */
async function run(pool, label = "salary payslip step 4 assignment snapshots") {
  const result = await pool.query(`
    UPDATE salaries s
    SET
      employee_classes = COALESCE(
        NULLIF(TRIM(s.employee_classes), ''),
        NULLIF(TRIM((
          SELECT STRING_AGG(DISTINCT c.name, ', ' ORDER BY c.name)
          FROM teacher_assignments ta
          JOIN classes c ON c.id = ta.class_id
          WHERE ta.teacher_id = s.user_id
        )), '')
      ),
      employee_subjects = COALESCE(
        NULLIF(TRIM(s.employee_subjects), ''),
        NULLIF(TRIM((
          SELECT STRING_AGG(DISTINCT subj.name, ', ' ORDER BY subj.name)
          FROM teacher_assignments ta
          JOIN subjects subj ON subj.id = ta.subject_id
          WHERE ta.teacher_id = s.user_id
        )), '')
      ),
      updated_at = CURRENT_TIMESTAMP
    WHERE s.paid = true
      AND s.user_id IS NOT NULL
      AND (
        NULLIF(TRIM(s.employee_classes), '') IS NULL
        OR NULLIF(TRIM(s.employee_subjects), '') IS NULL
      )
  `);

  const withAssignments = await pool.query(`
    SELECT COUNT(*)::int AS cnt
    FROM salaries s
    WHERE s.paid = true
      AND (
        NULLIF(TRIM(s.employee_classes), '') IS NOT NULL
        OR NULLIF(TRIM(s.employee_subjects), '') IS NOT NULL
      )
  `);

  console.log(
    `✅ ${label}: updated=${result.rowCount}, with_class_or_subject=${withAssignments.rows[0].cnt}`
  );
}

module.exports = { run };
