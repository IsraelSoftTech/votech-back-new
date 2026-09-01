"use strict";

/**
 * Point 4A — Debt Recording: dedicated debts ledger table.
 */
async function run(pool, label = "debt recording step 1") {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    await client.query(`
      CREATE TABLE IF NOT EXISTS debts (
        id SERIAL PRIMARY KEY,
        type VARCHAR(20) NOT NULL
          CHECK (type IN ('owed_by_school', 'owed_to_school')),
        party_name VARCHAR(255) NOT NULL,
        amount NUMERIC(14, 2) NOT NULL DEFAULT 0,
        currency VARCHAR(10) NOT NULL DEFAULT 'XAF',
        description TEXT,
        reference_number VARCHAR(100),
        date_recorded DATE NOT NULL DEFAULT CURRENT_DATE,
        due_date DATE,
        status VARCHAR(20) NOT NULL DEFAULT 'open'
          CHECK (status IN ('open', 'partial', 'paid', 'written_off')),
        amount_paid NUMERIC(14, 2) NOT NULL DEFAULT 0,
        balance NUMERIC(14, 2) NOT NULL DEFAULT 0,
        academic_year_id INTEGER REFERENCES academic_years(id) ON DELETE SET NULL,
        created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
        deleted_at TIMESTAMPTZ,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CONSTRAINT debts_amount_non_negative CHECK (amount >= 0),
        CONSTRAINT debts_amount_paid_non_negative CHECK (amount_paid >= 0),
        CONSTRAINT debts_balance_non_negative CHECK (balance >= 0)
      )
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_debts_type ON debts (type)
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_debts_status ON debts (status)
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_debts_date_recorded ON debts (date_recorded)
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_debts_deleted_at ON debts (deleted_at)
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_debts_academic_year_id ON debts (academic_year_id)
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
