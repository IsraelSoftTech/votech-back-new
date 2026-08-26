"use strict";

const crypto = require("crypto");
const { pool } = require("../../routes/utils");
const {
  attachListThumbsToRows,
  readCardThumbDataUriSync,
} = require("./studentPhotoThumb.service");

function attachCardThumbToRow(row) {
  if (!row?.photo_url?.trim()) return row;

  const thumb_src = readCardThumbDataUriSync(row.student_db_id);
  if (thumb_src) {
    return { ...row, has_photo: true, thumb_src };
  }

  return { ...row, has_photo: true };
}

function buildCardNumber(studentDbId) {
  const year = new Date().getFullYear();
  return `VTC-${year}-${String(studentDbId).padStart(5, "0")}`;
}

/**
 * Create an ID card row for a student (no-op if one already exists).
 * @param {number} studentDbId - students.id
 * @param {import('pg').PoolClient|null} client
 */
async function createIdCardForStudent(studentDbId, client = null) {
  const db = client || pool;
  const id = Number(studentDbId);
  if (!id) return null;

  const existing = await db.query(
    `SELECT * FROM student_id_cards WHERE student_id = $1 LIMIT 1`,
    [id]
  );
  if (existing.rows.length) return existing.rows[0];

  const qrToken = crypto.randomUUID();
  const cardNumber = buildCardNumber(id);

  const inserted = await db.query(
    `
    INSERT INTO student_id_cards (student_id, qr_token, card_number, issued_at, is_active)
    VALUES ($1, $2, $3, NOW(), true)
    ON CONFLICT (student_id) DO NOTHING
    RETURNING *
  `,
    [id, qrToken, cardNumber]
  );

  if (inserted.rows.length) return inserted.rows[0];

  const again = await db.query(
    `SELECT * FROM student_id_cards WHERE student_id = $1 LIMIT 1`,
    [id]
  );
  return again.rows[0] || null;
}

async function backfillMissingCards() {
  const { rows: missing } = await pool.query(`
    SELECT s.id
    FROM students s
    LEFT JOIN student_id_cards sic ON sic.student_id = s.id
    WHERE s."deletedAt" IS NULL AND sic.id IS NULL
  `);

  let created = 0;
  for (const row of missing) {
    const card = await createIdCardForStudent(row.id);
    if (card) created += 1;
  }
  invalidateIdCardListMetaCache();
  return { created, total: missing.length };
}

function buildListQuery({ yearFilter } = {}) {
  const params = [];
  let yearClause = "";
  if (yearFilter) {
    params.push(Number(yearFilter));
    yearClause = ` AND s.academic_year_id = $${params.length}`;
  }

  const sql = `
    SELECT
      s.id AS student_db_id,
      s.student_id,
      s.full_name,
      s.sex,
      s.date_of_birth,
      s.place_of_birth,
      s.registration_date,
      s.father_name,
      s.mother_name,
      s.guardian_contact,
      s.mother_contact,
      s.photo_url,
      s.class_id,
      s.specialty_id,
      s.academic_year_id,
      c.name AS class_name,
      sp.name AS specialty_name,
      ay.name AS academic_year_name,
      sic.id AS card_id,
      sic.qr_token,
      sic.card_number,
      sic.issued_at,
      sic.is_active,
      CASE WHEN sic.id IS NOT NULL THEN 'generated' ELSE 'missing' END AS card_status
    FROM students s
    LEFT JOIN student_id_cards sic ON sic.student_id = s.id
    LEFT JOIN classes c ON s.class_id = c.id
    LEFT JOIN specialties sp ON s.specialty_id = sp.id
    LEFT JOIN "academicYears" ay ON s.academic_year_id = ay.id
    WHERE s."deletedAt" IS NULL
    ${yearClause}
    ORDER BY s.full_name ASC
  `;

  return { sql, params };
}

async function listStudentIdCards({ yearFilter } = {}) {
  const { sql, params } = buildListQuery({ yearFilter });
  const { rows } = await pool.query(sql, params);
  return rows;
}

function buildYearClause(yearFilter, params) {
  if (!yearFilter) return "";
  params.push(Number(yearFilter));
  return ` AND s.academic_year_id = $${params.length}`;
}

const listMetaCache = new Map();
const META_TTL_MS = 90_000;

async function getCachedListMeta(yearFilter) {
  const key = String(yearFilter ?? "all");
  const hit = listMetaCache.get(key);
  if (hit && Date.now() - hit.ts < META_TTL_MS) {
    return { stats: hit.stats, classes: hit.classes };
  }

  const [stats, classes] = await Promise.all([
    getStudentIdCardStats({ yearFilter }),
    listStudentIdCardClasses({ yearFilter }),
  ]);

  listMetaCache.set(key, { stats, classes, ts: Date.now() });
  return { stats, classes };
}

function invalidateIdCardListMetaCache() {
  listMetaCache.clear();
}

async function getStudentIdCardStats({ yearFilter } = {}) {
  const params = [];
  const yearClause = buildYearClause(yearFilter, params);
  const { rows } = await pool.query(
    `
    SELECT
      COUNT(*)::int AS total,
      COUNT(sic.id)::int AS generated,
      (COUNT(*) - COUNT(sic.id))::int AS missing
    FROM students s
    LEFT JOIN student_id_cards sic ON sic.student_id = s.id
    WHERE s."deletedAt" IS NULL
    ${yearClause}
  `,
    params
  );
  return (
    rows[0] || {
      total: 0,
      generated: 0,
      missing: 0,
    }
  );
}

async function listStudentIdCardClasses({ yearFilter } = {}) {
  const params = [];
  const yearClause = buildYearClause(yearFilter, params);
  const { rows } = await pool.query(
    `
    SELECT DISTINCT c.name AS class_name
    FROM students s
    INNER JOIN classes c ON s.class_id = c.id
    WHERE s."deletedAt" IS NULL
    ${yearClause}
    ORDER BY c.name ASC
  `,
    params
  );
  return rows.map((r) => r.class_name).filter(Boolean);
}

async function listStudentIdCardsPaginated({
  yearFilter,
  page = 1,
  limit = 10,
  search = "",
  className = "",
  cardStatus = "",
} = {}) {
  const params = [];
  const yearClause = buildYearClause(yearFilter, params);
  const joins = `
    FROM students s
    LEFT JOIN student_id_cards sic ON sic.student_id = s.id
    LEFT JOIN classes c ON s.class_id = c.id
    LEFT JOIN specialties sp ON s.specialty_id = sp.id
    LEFT JOIN "academicYears" ay ON s.academic_year_id = ay.id
  `;

  let filterClause = `WHERE s."deletedAt" IS NULL${yearClause}`;

  const q = String(search || "").trim().toLowerCase();
  if (q) {
    params.push(`%${q}%`);
    const idx = params.length;
    filterClause += ` AND (
      LOWER(s.full_name) LIKE $${idx}
      OR LOWER(s.student_id) LIKE $${idx}
      OR LOWER(COALESCE(sic.card_number, '')) LIKE $${idx}
    )`;
  }

  if (className && className !== "all") {
    params.push(className);
    filterClause += ` AND c.name = $${params.length}`;
  }

  if (cardStatus === "generated") {
    filterClause += " AND sic.id IS NOT NULL";
  } else if (cardStatus === "missing") {
    filterClause += " AND sic.id IS NULL";
  }

  const safeLimit = Math.min(Math.max(Number(limit) || 10, 1), 100);
  const safePage = Math.max(Number(page) || 1, 1);
  const offset = (safePage - 1) * safeLimit;

  const listSql = `
    SELECT
      s.id AS student_db_id,
      s.student_id,
      s.full_name,
      s.registration_date,
      (s.photo_url IS NOT NULL AND TRIM(s.photo_url) <> '') AS has_photo,
      c.name AS class_name,
      sp.name AS specialty_name,
      ay.name AS academic_year_name,
      sic.card_number,
      CASE WHEN sic.id IS NOT NULL THEN 'generated' ELSE 'missing' END AS card_status,
      COUNT(*) OVER()::int AS total_count
    ${joins}
    ${filterClause}
    ORDER BY s.full_name ASC
    LIMIT $${params.length + 1} OFFSET $${params.length + 2}
  `;

  const listParams = [...params, safeLimit, offset];

  const [meta, listResult] = await Promise.all([
    getCachedListMeta(yearFilter),
    pool.query(listSql, listParams),
  ]);

  const filteredTotal = listResult.rows[0]?.total_count ?? 0;
  const bareRows = listResult.rows.map(({ total_count, ...row }) => row);
  const rowsWithThumbs = attachListThumbsToRows(bareRows);

  return {
    rows: rowsWithThumbs,
    total: filteredTotal,
    page: safePage,
    limit: safeLimit,
    totalPages: Math.max(1, Math.ceil(filteredTotal / safeLimit)),
    stats: meta.stats,
    classes: meta.classes,
  };
}

async function getStudentIdCardsByIds(ids = []) {
  const numericIds = [...new Set(ids.map((id) => Number(id)).filter(Boolean))];
  if (!numericIds.length) return [];

  const { rows } = await pool.query(
    `
    SELECT
      s.id AS student_db_id,
      s.student_id,
      s.full_name,
      s.sex,
      s.date_of_birth,
      s.place_of_birth,
      s.registration_date,
      s.father_name,
      s.mother_name,
      s.guardian_contact,
      s.photo_url,
      c.name AS class_name,
      sp.name AS specialty_name,
      ay.name AS academic_year_name,
      sic.id AS card_id,
      sic.qr_token,
      sic.card_number,
      sic.issued_at,
      sic.is_active,
      CASE WHEN sic.id IS NOT NULL THEN 'generated' ELSE 'missing' END AS card_status
    FROM students s
    LEFT JOIN student_id_cards sic ON sic.student_id = s.id
    LEFT JOIN classes c ON s.class_id = c.id
    LEFT JOIN specialties sp ON s.specialty_id = sp.id
    LEFT JOIN "academicYears" ay ON s.academic_year_id = ay.id
    WHERE s."deletedAt" IS NULL AND s.id = ANY($1::int[])
    ORDER BY s.full_name ASC
  `,
    [numericIds]
  );
  return rows.map((row) => attachCardThumbToRow(row));
}

async function getStudentIdCardByStudentDbId(studentDbId) {
  const { rows } = await pool.query(
    `
    SELECT
      s.id AS student_db_id,
      s.student_id,
      s.full_name,
      s.sex,
      s.date_of_birth,
      s.place_of_birth,
      s.registration_date,
      s.father_name,
      s.mother_name,
      s.guardian_contact,
      s.mother_contact,
      s.photo_url,
      s.class_id,
      s.specialty_id,
      s.academic_year_id,
      c.name AS class_name,
      sp.name AS specialty_name,
      ay.name AS academic_year_name,
      sic.id AS card_id,
      sic.qr_token,
      sic.card_number,
      sic.issued_at,
      sic.is_active,
      CASE WHEN sic.id IS NOT NULL THEN 'generated' ELSE 'missing' END AS card_status
    FROM students s
    LEFT JOIN student_id_cards sic ON sic.student_id = s.id
    LEFT JOIN classes c ON s.class_id = c.id
    LEFT JOIN specialties sp ON s.specialty_id = sp.id
    LEFT JOIN "academicYears" ay ON s.academic_year_id = ay.id
    WHERE s."deletedAt" IS NULL AND s.id = $1
    LIMIT 1
  `,
    [Number(studentDbId)]
  );
  const row = rows[0] || null;
  if (!row) return null;
  return attachCardThumbToRow(row);
}

module.exports = {
  buildCardNumber,
  createIdCardForStudent,
  backfillMissingCards,
  listStudentIdCards,
  listStudentIdCardsPaginated,
  getStudentIdCardStats,
  getStudentIdCardsByIds,
  getStudentIdCardByStudentDbId,
  invalidateIdCardListMetaCache,
};
