"use strict";

/**
 * Point 6 — Step 1.1: student_id_cards table + backfill existing students.
 * Idempotent: safe to run on every server start.
 */

async function run(pool, label = "student id cards step 1") {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    await client.query(`
      CREATE TABLE IF NOT EXISTS student_id_cards (
        id SERIAL PRIMARY KEY,
        student_id INTEGER NOT NULL UNIQUE REFERENCES students(id) ON DELETE CASCADE,
        qr_token UUID NOT NULL UNIQUE,
        card_number VARCHAR(100) NOT NULL,
        issued_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        is_active BOOLEAN NOT NULL DEFAULT true
      )
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_student_id_cards_qr_token
        ON student_id_cards (qr_token)
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_student_id_cards_active
        ON student_id_cards (is_active)
        WHERE is_active = true
    `);

    // Backfill cards for students without one
    const { rows: missing } = await client.query(`
      SELECT s.id
      FROM students s
      LEFT JOIN student_id_cards sic ON sic.student_id = s.id
      WHERE s."deletedAt" IS NULL
        AND sic.id IS NULL
    `);

    for (const row of missing) {
      const crypto = require("crypto");
      const qrToken = crypto.randomUUID();
      const cardNumber = `VTC-${new Date().getFullYear()}-${String(row.id).padStart(5, "0")}`;
      await client.query(
        `
        INSERT INTO student_id_cards (student_id, qr_token, card_number, issued_at, is_active)
        VALUES ($1, $2, $3, NOW(), true)
        ON CONFLICT (student_id) DO NOTHING
      `,
        [row.id, qrToken, cardNumber]
      );
    }

    await client.query("COMMIT");
    if (missing.length) {
      console.log(`✅ ${label}: backfilled ${missing.length} student ID card(s)`);
    } else {
      console.log(`✅ ${label}: schema ready`);
    }
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

module.exports = { run };
