"use strict";

const { pool } = require("../../routes/utils");

const DEFAULTS = {
  school_name: "VOTECH S7 ACADEMY",
  motto: "Welfare, Productivity, Self Actualization",
  motto_fr: "PAIX - TRAVAIL - PATRIE",
  motto_en: "PEACE - WORK - FATHERLAND",
  card_title: "STUDENT ID CARD",
  qr_caption: "Scan for attendance",
};

async function ensureSettingsTable() {
  await pool.query(`
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

  await pool.query(`
    INSERT INTO id_card_settings (id)
    VALUES (1)
    ON CONFLICT (id) DO NOTHING
  `);
}

async function getIdCardSettings() {
  await ensureSettingsTable();
  const { rows } = await pool.query(`SELECT * FROM id_card_settings WHERE id = 1`);
  return { ...DEFAULTS, ...(rows[0] || {}) };
}

async function updateIdCardSettings(payload, userId = null) {
  await ensureSettingsTable();

  const fields = [
    "school_name",
    "motto",
    "motto_fr",
    "motto_en",
    "card_title",
    "qr_caption",
  ];

  const sets = [];
  const vals = [];
  let idx = 0;

  fields.forEach((key) => {
    if (payload[key] !== undefined && payload[key] !== null) {
      idx += 1;
      sets.push(`${key} = $${idx}`);
      vals.push(String(payload[key]).trim());
    }
  });

  if (!sets.length) {
    return getIdCardSettings();
  }

  idx += 1;
  sets.push(`updated_at = NOW()`);
  idx += 1;
  sets.push(`updated_by = $${idx}`);
  vals.push(userId);

  const { rows } = await pool.query(
    `UPDATE id_card_settings SET ${sets.join(", ")} WHERE id = 1 RETURNING *`,
    vals
  );

  return { ...DEFAULTS, ...(rows[0] || {}) };
}

module.exports = {
  DEFAULTS,
  getIdCardSettings,
  updateIdCardSettings,
};
