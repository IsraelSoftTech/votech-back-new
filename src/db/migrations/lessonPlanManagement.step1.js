"use strict";

/**
 * Point 1 — Lesson Plan Management: class & department columns for filtering.
 */
async function run(pool, label = "lesson plan management step 1") {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    await client.query(`
      ALTER TABLE lesson_plans
        ADD COLUMN IF NOT EXISTS class_id INTEGER REFERENCES classes(id) ON DELETE SET NULL,
        ADD COLUMN IF NOT EXISTS department_id INTEGER REFERENCES specialties(id) ON DELETE SET NULL
    `);

    await client.query(`
      ALTER TABLE lessons
        ADD COLUMN IF NOT EXISTS class_id INTEGER REFERENCES classes(id) ON DELETE SET NULL,
        ADD COLUMN IF NOT EXISTS department_id INTEGER REFERENCES specialties(id) ON DELETE SET NULL
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_lesson_plans_class_id
        ON lesson_plans (class_id)
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_lesson_plans_department_id
        ON lesson_plans (department_id)
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_lessons_class_id
        ON lessons (class_id)
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_lessons_department_id
        ON lessons (department_id)
    `);

    await client.query("COMMIT");
    console.log(`✅ ${label}: schema ready`);
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { run };
