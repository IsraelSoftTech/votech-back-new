"use strict";

/**
 * dumpGenerator.js
 *
 * Generates a scoped, gzipped NDJSON dump file for a given user.
 * Streams data table by table using PostgreSQL named cursors —
 * peak Node memory is one cursor batch (~200 rows) at any time.
 *
 * File format (one JSON object per line):
 *   {"type":"meta","generatedAt":"...","userId":N,"role":"...","scopeVersion":N}
 *   {"type":"table_start","name":"academic_years"}
 *   {"type":"row","table":"academic_years","data":{...enriched row...}}
 *   ...
 *   {"type":"table_end","name":"academic_years","count":4}
 *   {"type":"end","totalRows":N,"checksum":"sha256hex"}
 *
 * FK enrichment: each row is enriched with {col}__sync_id columns for every
 * FK parent so the client can remap integer IDs to local SQLite IDs.
 *
 * Password handling:
 *   - Admin3       → gets all password hashes (manages user accounts)
 *   - Everyone else → gets only their own password hash; all other user
 *                     rows have password deleted before writing
 *
 * Cursor ordering uses sync_id (uuid, present on every table) instead of
 * id — some tables (e.g. cnps_preferences) have no integer id column.
 */

const fs = require("fs");
const path = require("path");
const zlib = require("zlib");
const crypto = require("crypto");

const { pool } = require("../../../routes/utils");
const { SYNC_ORDER } = require("./syncOrder");
const { FK_MAP } = require("./fkmap");
const {
  SCOPE_CONFIG,
  STRATEGY,
  ROLES,
  ADMIN_ROLES,
  FULL_ADMIN_ROLES,
} = require("./scopeConfig");

// ── Constants ──────────────────────────────────────────────────────────────────

const DUMP_DIR = path.join(process.cwd(), "sync-dumps");
const CURSOR_BATCH = 200;

if (!fs.existsSync(DUMP_DIR)) {
  fs.mkdirSync(DUMP_DIR, { recursive: true });
}

// ── Table name → SCOPE_CONFIG key lookup ──────────────────────────────────────
//
// SYNC_ORDER uses actual PostgreSQL table names (e.g. "academic_years",
// "academicYears"). SCOPE_CONFIG uses PascalCase keys (e.g. "AcademicYear").
// This map bridges the two.

const _models = require("../../models/index.model");
const TABLE_NAME_TO_CONFIG_KEY = {};

for (const [configKey, config] of Object.entries(SCOPE_CONFIG)) {
  if (!config.model) continue;
  const model = _models[config.model];
  if (!model) continue;
  try {
    let name = model.getTableName();
    if (typeof name === "object" && name !== null) name = name.tableName;
    if (name) TABLE_NAME_TO_CONFIG_KEY[name] = configKey;
  } catch (_) {}
}

// Any SYNC_ORDER key not resolved via model maps to itself as fallback
for (const tableKey of SYNC_ORDER) {
  if (!TABLE_NAME_TO_CONFIG_KEY[tableKey]) {
    TABLE_NAME_TO_CONFIG_KEY[tableKey] = tableKey;
  }
}

// ── Resolve real PostgreSQL table name ─────────────────────────────────────────

function resolveTableName(config, fallback) {
  if (!config || !config.model) return fallback;
  const model = _models[config.model];
  if (!model) return fallback;
  try {
    let name = model.getTableName();
    if (typeof name === "object" && name !== null) name = name.tableName;
    return name || fallback;
  } catch (_) {
    return fallback;
  }
}

// ── Scope resolution ───────────────────────────────────────────────────────────

async function resolveUserScope(userId, role) {
  if (FULL_ADMIN_ROLES.includes(role)) {
    return {
      classIds: null,
      subjectIds: null,
      isFullAdmin: true,
      isAdminRole: true,
    };
  }

  const isAdminRole = ADMIN_ROLES.includes(role);

  const { rows } = await pool.query(
    `SELECT DISTINCT cs.class_id, cs.subject_id
     FROM class_subjects cs
     WHERE cs.teacher_id = $1
     UNION
     SELECT DISTINCT ta.class_id, NULL AS subject_id
     FROM teacher_assignments ta
     WHERE ta.teacher_id = $1`,
    [userId]
  );

  const classIds = [...new Set(rows.map((r) => r.class_id).filter(Boolean))];
  const subjectIds = [
    ...new Set(rows.map((r) => r.subject_id).filter(Boolean)),
  ];

  return { classIds, subjectIds, isFullAdmin: false, isAdminRole };
}

// ── Per-table scoped WHERE clause builder ──────────────────────────────────────

/**
 * Returns { whereClause, params } or null if the table should be skipped.
 * All column references are prefixed with t. to avoid ambiguity in joins.
 */
function buildScopedQuery(configKey, tableName, scope) {
  const config = SCOPE_CONFIG[configKey];
  if (!config || config.strategy === STRATEGY.NEVER) return null;

  const { classIds, subjectIds, isFullAdmin, isAdminRole, userId, role } =
    scope;

  if (config.strategy === STRATEGY.PUBLIC) {
    return { whereClause: "", params: [] };
  }

  if (config.strategy === STRATEGY.FULL_FOR_ROLES) {
    if (!config.allowedRoles.includes(role)) return null;
    return { whereClause: "", params: [] };
  }

  if (config.strategy === STRATEGY.OWNED) {
    // User — all rows, password handled per-row in streamTable
    if (configKey === "User") {
      return { whereClause: "", params: [] };
    }

    // DisciplineCase
    if (configKey === "DisciplineCase") {
      const fullRoles = [...ADMIN_ROLES, ROLES.DISCIPLINE, ROLES.PSYCHOSOCIAL];
      if (fullRoles.includes(role)) return { whereClause: "", params: [] };
      return {
        whereClause: "WHERE t.recorded_by = $1 OR t.teacher_id = $1",
        params: [userId],
      };
    }

    // Group
    if (configKey === "Group") {
      return {
        whereClause: `WHERE t.id IN (
          SELECT group_id FROM group_participants WHERE user_id = $1
        )`,
        params: [userId],
      };
    }

    // GroupParticipant
    if (configKey === "GroupParticipant") {
      return {
        whereClause: `WHERE t.group_id IN (
          SELECT group_id FROM group_participants WHERE user_id = $1
        )`,
        params: [userId],
      };
    }

    // Message — $1 is safe to reuse multiple times in PostgreSQL
    if (configKey === "Message") {
      return {
        whereClause: `WHERE t.sender_id = $1
          OR t.receiver_id = $1
          OR t.group_id IN (
            SELECT group_id FROM group_participants WHERE user_id = $1
          )`,
        params: [userId],
      };
    }

    // Generic filterType
    const filterKey = config.filterKey || "class_id";

    switch (config.filterType) {
      case "BY_CLASS_IDS":
        if (isFullAdmin || isAdminRole) return { whereClause: "", params: [] };
        if (!classIds || !classIds.length) return null;
        return {
          whereClause: `WHERE t."${filterKey}" = ANY($1)`,
          params: [classIds],
        };

      case "BY_SUBJECT_IDS":
        if (isFullAdmin) return { whereClause: "", params: [] };
        if (!subjectIds || !subjectIds.length) return null;
        return { whereClause: `WHERE t.id = ANY($1)`, params: [subjectIds] };

      case "BY_CLASS_AND_SUBJECT":
        if (isFullAdmin) return { whereClause: "", params: [] };
        if (!classIds?.length || !subjectIds?.length) return null;
        return {
          whereClause: `WHERE t.class_id = ANY($1) AND t.subject_id = ANY($2)`,
          params: [classIds, subjectIds],
        };

      case "BY_USER_ID":
        if (isAdminRole) return { whereClause: "", params: [] };
        return { whereClause: `WHERE t."${filterKey}" = $1`, params: [userId] };

      case "BY_USER_ID_ONLY":
        return { whereClause: `WHERE t."${filterKey}" = $1`, params: [userId] };

      default:
        console.warn(
          `[DumpGenerator] Unknown filterType "${config.filterType}" for "${configKey}" — including all rows`
        );
        return { whereClause: "", params: [] };
    }
  }

  return null;
}

// ── FK enrichment ──────────────────────────────────────────────────────────────

function buildEnrichedSelect(tableName) {
  const fks = FK_MAP[tableName];
  if (!fks || fks.length === 0) {
    return { selectClause: "t.*", joinClauses: "" };
  }

  const joins = [];
  const extraSelects = [];
  const aliasCount = {};

  for (const { col, refTable } of fks) {
    const aliasBase = refTable.replace(/[^a-zA-Z0-9]/g, "_");
    aliasCount[aliasBase] = (aliasCount[aliasBase] || 0) + 1;
    const alias = `${aliasBase}_${aliasCount[aliasBase]}`;

    joins.push(`LEFT JOIN "${refTable}" ${alias} ON ${alias}.id = t."${col}"`);
    extraSelects.push(`${alias}.sync_id AS "${col}__sync_id"`);
  }

  return {
    selectClause: `t.*, ${extraSelects.join(", ")}`,
    joinClauses: joins.join("\n      "),
  };
}

// ── User SELECT builder ────────────────────────────────────────────────────────

/**
 * Build the explicit SELECT column list for the users table.
 * Always includes password so we can handle per-row redaction in the
 * fetch loop. Confirmed columns from actual DB schema.
 */
function buildUserSelect(extraSelects) {
  const baseColumns = [
    `t.id`,
    `t.sync_id`,
    `t.username`,
    `t.name`,
    `t.email`,
    `t.contact`,
    `t.gender`,
    `t.role`,
    `t.suspended`,
    `t.profile_image_url`,
    `t.password`, // always fetched — redacted per-row for non-Admin3
    `t."createdAt"`,
    `t."updatedAt"`,
    `t."updatedBy"`,
    `t."deviceId"`,
    `t."scopeVersion"`,
  ];

  return [...baseColumns, ...extraSelects].join(", ");
}

// ── Core cursor streaming ──────────────────────────────────────────────────────

async function streamTable(tableKey, configKey, tableName, scope, writeStream) {
  const scopedQuery = buildScopedQuery(configKey, tableName, scope);
  if (!scopedQuery) return 0;

  const { whereClause, params } = scopedQuery;
  const { selectClause, joinClauses } = buildEnrichedSelect(tableName);

  // Build final SELECT — handle User table password logic
  let finalSelect;
  if (configKey === "User") {
    // Extract any extra __sync_id selects that buildEnrichedSelect added
    const extraParts = selectClause.startsWith("t.*, ")
      ? selectClause.slice("t.*, ".length).split(", ").filter(Boolean)
      : [];
    finalSelect = buildUserSelect(extraParts);
  } else {
    finalSelect = selectClause;
  }

  // Use sync_id for ORDER BY — present on every table including those
  // without an integer id column (e.g. cnps_preferences, hod_teachers,
  // group_participants, specialty_classes)
  const cursorName = `dump_cursor_${Date.now()}_${Math.random()
    .toString(36)
    .slice(2)}`;
  const client = await pool.connect();
  let rowCount = 0;

  try {
    await client.query("BEGIN");

    const declareSql = `
      DECLARE "${cursorName}" CURSOR FOR
      SELECT ${finalSelect}
      FROM "${tableName}" t
      ${joinClauses}
      ${whereClause}
      ORDER BY t.sync_id
    `;

    await client.query(declareSql, params);

    while (true) {
      const { rows } = await client.query(
        `FETCH ${CURSOR_BATCH} FROM "${cursorName}"`
      );
      if (!rows.length) break;

      for (const row of rows) {
        // Password handling for users table:
        //   Admin3         → keep all passwords (manages user accounts)
        //   Everyone else  → keep own password hash, delete all others
        if (configKey === "User") {
          if (scope.role !== ROLES.ADMIN3 && row.id !== scope.userId) {
            delete row.password;
          }
        }

        const line =
          JSON.stringify({ type: "row", table: tableKey, data: row }) + "\n";
        const ok = writeStream.write(line);
        if (!ok) {
          await new Promise((resolve) => writeStream.once("drain", resolve));
        }
      }

      rowCount += rows.length;
    }

    await client.query(`CLOSE "${cursorName}"`);
    await client.query("COMMIT");
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release();
  }

  return rowCount;
}

// ── Main export ────────────────────────────────────────────────────────────────

async function generateDump(userId, role) {
  const generatedAt = new Date();
  const scopeVersion = parseInt(process.env.SCOPE_VERSION || "1", 10);
  const fileName = `dump_${userId}_${role}_${generatedAt.getTime()}.ndjson.gz`;
  const filePath = path.join(DUMP_DIR, fileName);

  const scope = await resolveUserScope(userId, role);
  scope.userId = userId;
  scope.role = role;

  const fileStream = fs.createWriteStream(filePath);
  const gzip = zlib.createGzip({ level: 6 });
  gzip.pipe(fileStream);

  const hash = crypto.createHash("sha256");
  let totalRows = 0;

  const writeLine = async (obj) => {
    const line = JSON.stringify(obj) + "\n";
    hash.update(line);
    const ok = gzip.write(line);
    if (!ok) {
      await new Promise((resolve) => gzip.once("drain", resolve));
    }
  };

  try {
    await writeLine({
      type: "meta",
      generatedAt: generatedAt.toISOString(),
      userId,
      role,
      scopeVersion,
    });

    for (const tableKey of SYNC_ORDER) {
      const configKey = TABLE_NAME_TO_CONFIG_KEY[tableKey] ?? tableKey;
      const config = SCOPE_CONFIG[configKey];
      const tableName = resolveTableName(config, tableKey);

      await writeLine({ type: "table_start", name: tableKey });

      let tableRows = 0;
      try {
        tableRows = await streamTable(tableKey, configKey, tableName, scope, {
          write: (chunk) => {
            hash.update(chunk);
            return gzip.write(chunk);
          },
          once: (event, cb) => gzip.once(event, cb),
        });
      } catch (err) {
        console.error(
          `[DumpGenerator] Failed streaming "${tableKey}" (config="${configKey}", pg="${tableName}"):`,
          err.message
        );
        await writeLine({
          type: "table_error",
          name: tableKey,
          error: err.message,
        });
      }

      await writeLine({ type: "table_end", name: tableKey, count: tableRows });
      totalRows += tableRows;

      console.log(
        `[DumpGenerator] userId=${userId} table=${tableKey} (config=${configKey}, pg=${tableName}) rows=${tableRows}`
      );
    }

    const checksum = hash.digest("hex");
    const endLine = JSON.stringify({ type: "end", totalRows, checksum }) + "\n";
    const ok = gzip.write(endLine);
    if (!ok) await new Promise((resolve) => gzip.once("drain", resolve));

    await new Promise((resolve, reject) => {
      gzip.end((err) => {
        if (err) return reject(err);
        fileStream.on("finish", resolve);
        fileStream.on("error", reject);
      });
    });

    const stats = fs.statSync(filePath);
    console.log(
      `[DumpGenerator] Done. userId=${userId} role=${role} ` +
        `rows=${totalRows} size=${(stats.size / 1024 / 1024).toFixed(
          2
        )}MB file=${fileName}`
    );

    return { filePath, fileName, generatedAt, totalRows };
  } catch (err) {
    gzip.destroy();
    fileStream.destroy();
    try {
      fs.unlinkSync(filePath);
    } catch (_) {}
    throw err;
  }
}

function deleteDumpFile(filePath) {
  try {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
      console.log(`[DumpGenerator] Deleted dump file: ${filePath}`);
    }
  } catch (err) {
    console.error(
      `[DumpGenerator] Failed to delete dump file ${filePath}:`,
      err.message
    );
  }
}

function getDumpDir() {
  return DUMP_DIR;
}

module.exports = { generateDump, deleteDumpFile, getDumpDir };
