"use strict";

/**
 * Point 8 — User Guide Module, Step 1: guides table + role targeting table.
 *
 * user_guides holds one guide (text, document, video or external link).
 * user_guide_roles holds which account roles may see it; the sentinel role
 * 'all' means every role. Keep the role list in sync with VALID_ROLES in
 * backnew/routes/userGuides.js — a new account role needs both updated.
 */
async function run(pool, label = "user guides step 1") {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    await client.query(`
      CREATE TABLE IF NOT EXISTS user_guides (
        id SERIAL PRIMARY KEY,
        title VARCHAR(200) NOT NULL,
        description TEXT,
        content_type VARCHAR(20) NOT NULL
          CHECK (content_type IN ('text', 'document', 'video', 'link')),
        body TEXT,
        file_url TEXT,
        external_url TEXT,
        file_name TEXT,
        file_size BIGINT,
        mime_type VARCHAR(100),
        category VARCHAR(100),
        sort_order INTEGER NOT NULL DEFAULT 0,
        is_published BOOLEAN NOT NULL DEFAULT TRUE,
        view_count INTEGER NOT NULL DEFAULT 0,
        created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CONSTRAINT user_guides_title_not_blank
          CHECK (char_length(btrim(title)) > 0),
        CONSTRAINT user_guides_file_size_non_negative
          CHECK (file_size IS NULL OR file_size >= 0),
        CONSTRAINT user_guides_view_count_non_negative
          CHECK (view_count >= 0),
        CONSTRAINT user_guides_content_payload_check CHECK (
          (content_type = 'text' AND char_length(btrim(coalesce(body, ''))) > 0)
          OR (content_type IN ('document', 'video')
              AND char_length(btrim(coalesce(file_url, ''))) > 0)
          OR (content_type = 'link'
              AND char_length(btrim(coalesce(external_url, ''))) > 0)
        )
      )
    `);

    await client.query(`
      CREATE TABLE IF NOT EXISTS user_guide_roles (
        id SERIAL PRIMARY KEY,
        guide_id INTEGER NOT NULL REFERENCES user_guides(id) ON DELETE CASCADE,
        role VARCHAR(30) NOT NULL
          CHECK (role IN (
            'all', 'Admin1', 'Admin2', 'Admin3', 'Admin4',
            'Teacher', 'Discipline', 'Psychosocialist'
          )),
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        UNIQUE (guide_id, role)
      )
    `);

    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_user_guide_roles_role
        ON user_guide_roles (role)
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_user_guide_roles_guide_id
        ON user_guide_roles (guide_id)
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_user_guides_published
        ON user_guides (is_published, sort_order, created_at DESC)
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_user_guides_category
        ON user_guides (category)
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS idx_user_guides_content_type
        ON user_guides (content_type)
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
