"use strict";

/**
 * Point 6 — ID card settings + photo thumbnails support.
 */

async function run(pool, label = "student id cards step 2") {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    await client.query(`
      ALTER TABLE students
        ADD COLUMN IF NOT EXISTS photo_thumb_url VARCHAR(255)
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS id_card_settings (
        id INTEGER PRIMARY KEY DEFAULT 1 CHECK (id = 1),
        school_name VARCHAR(255) NOT NULL DEFAULT 'VOTECH S7 ACADEMY',
        motto VARCHAR(255) NOT NULL DEFAULT 'Welfare, Productivity, Self Actualization',
        motto_fr VARCHAR(255) NOT NULL DEFAULT 'PAIX - TRAVAIL - PATRIE',
        motto_en VARCHAR(255) NOT NULL DEFAULT 'PEACE - WORK - FATHERLAND',
        card_title VARCHAR(120) NOT NULL DEFAULT 'STUDENT ID CARD',
        qr_caption VARCHAR(120) NOT NULL DEFAULT 'Scan for attendance',
        updated_at TIMESTAMPTZ DEFAULT NOW(),
        updated_by INTEGER REFERENCES users(id) ON DELETE SET NULL
      )
    `);

    await client.query(`
      INSERT INTO id_card_settings (id)
      VALUES (1)
      ON CONFLICT (id) DO NOTHING
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
