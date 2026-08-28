"use strict";

/**
 * scopeResolver.js
 *
 * Resolves the scoped data payload for a given user and role.
 * Used by:
 *   - Delta sync  → resolveDelta(userId, role, since)
 *   - Manifest    → resolveManifest(userId, role)
 *   - Slice       → resolveSlice(userId, role, tableKey, offset, limit)
 *
 * Key fix: _execute now resolves the real PostgreSQL table name via
 * _resolveTableName() before any query — same as resolveSlice already did.
 * Previously _execute passed Sequelize model names (e.g. "AcademicYear")
 * directly into raw SQL, causing every query to fail silently and return
 * empty results for delta sync.
 *
 * Both academic_years (legacy) and academicYears (new) are supported —
 * each has its own model and resolves to its own real table name.
 */

const { QueryTypes } = require("sequelize");
const {
  ROLES,
  ADMIN_ROLES,
  FULL_ADMIN_ROLES,
  STRATEGY,
  FILTER_TYPE,
  SCOPE_CONFIG,
} = require("./scopeConfig");

const models = require("../../models/index.model");
const { sequelize } = require("../../models/index");
const { pool } = require("../../../routes/utils");

class ScopeResolver {
  // ── Table name resolution ──────────────────────────────────────────────────

  /**
   * Resolve the actual PostgreSQL table name from a Sequelize model.
   * Handles string return, { tableName, schema } object return, and
   * missing models gracefully.
   */
  _resolveTableName(config) {
    if (!config.model) return null;
    const _model = models[config.model];
    if (!_model) {
      console.warn(
        `[ScopeResolver] Model "${config.model}" not found in models`
      );
      return null;
    }
    let name = _model.getTableName();
    if (typeof name === "object" && name !== null) name = name.tableName;
    if (!name) {
      name =
        config.model.replace(/([a-z])([A-Z])/g, "$1_$2").toLowerCase() + "s";
      console.warn(
        `[ScopeResolver] No tableName for "${config.model}", guessed "${name}"`
      );
    }
    return name;
  }

  // ── Class/subject scope resolution ────────────────────────────────────────

  async _resolveClassScope(userId) {
    const rows = await pool.query(
      `SELECT DISTINCT cs.class_id, cs.subject_id
       FROM class_subjects cs
       WHERE cs.teacher_id = $1
       UNION
       SELECT DISTINCT ta.class_id, NULL AS subject_id
       FROM teacher_assignments ta
       WHERE ta.teacher_id = $1`,
      [userId]
    );
    const classIds = [
      ...new Set(rows.rows.map((r) => r.class_id).filter(Boolean)),
    ];
    const subjectIds = [
      ...new Set(rows.rows.map((r) => r.subject_id).filter(Boolean)),
    ];
    return { classIds, subjectIds };
  }

  // ── Pool query helpers ─────────────────────────────────────────────────────

  /**
   * Simple SELECT with optional WHERE clause and since filter.
   * Always uses the real resolved table name.
   */
  async _poolQueryAll(tableName, since) {
    try {
      if (since) {
        const { rows } = await pool.query(
          `SELECT * FROM "${tableName}" WHERE "updatedAt" > $1`,
          [since]
        );
        return rows;
      }
      const { rows } = await pool.query(`SELECT * FROM "${tableName}"`);
      return rows;
    } catch (err) {
      if (err.code === "42P01") {
        console.warn(
          `[ScopeResolver] Table "${tableName}" does not exist — skipping`
        );
        return [];
      }
      // updatedAt column may not exist on some tables — retry without since
      if (err.code === "42703" && since) {
        console.warn(
          `[ScopeResolver] "${tableName}" has no updatedAt — fetching all`
        );
        try {
          const { rows } = await pool.query(`SELECT * FROM "${tableName}"`);
          return rows;
        } catch (inner) {
          console.error(
            `[ScopeResolver] Failed querying "${tableName}":`,
            inner.message
          );
          return [];
        }
      }
      throw err;
    }
  }

  async _poolQueryByClassIds(tableName, filterKey, classIds, since) {
    if (!classIds.length) return [];
    try {
      const sinceClause = since ? `AND "updatedAt" > $2` : "";
      const params = since ? [classIds, since] : [classIds];
      const { rows } = await pool.query(
        `SELECT * FROM "${tableName}" WHERE "${filterKey}" = ANY($1) ${sinceClause}`,
        params
      );
      return rows;
    } catch (err) {
      if (err.code === "42P01" || err.code === "42703") {
        console.warn(
          `[ScopeResolver] Query error on "${tableName}": ${err.message}`
        );
        return [];
      }
      throw err;
    }
  }

  async _poolQueryBySubjectIds(tableName, subjectIds, since) {
    if (!subjectIds.length) return [];
    try {
      const sinceClause = since ? `AND "updatedAt" > $2` : "";
      const params = since ? [subjectIds, since] : [subjectIds];
      const { rows } = await pool.query(
        `SELECT * FROM "${tableName}" WHERE id = ANY($1) ${sinceClause}`,
        params
      );
      return rows;
    } catch (err) {
      if (err.code === "42P01" || err.code === "42703") {
        console.warn(
          `[ScopeResolver] Query error on "${tableName}": ${err.message}`
        );
        return [];
      }
      throw err;
    }
  }

  async _poolQueryByClassAndSubject(tableName, classIds, subjectIds, since) {
    if (!classIds.length || !subjectIds.length) return [];
    try {
      const sinceClause = since ? `AND "updatedAt" > $3` : "";
      const params = since
        ? [classIds, subjectIds, since]
        : [classIds, subjectIds];
      const { rows } = await pool.query(
        `SELECT * FROM "${tableName}"
         WHERE class_id = ANY($1) AND subject_id = ANY($2)
         ${sinceClause}`,
        params
      );
      return rows;
    } catch (err) {
      if (err.code === "42P01" || err.code === "42703") {
        console.warn(
          `[ScopeResolver] Query error on "${tableName}": ${err.message}`
        );
        return [];
      }
      throw err;
    }
  }

  async _poolQueryByUserId(tableName, filterKey, userId, since) {
    try {
      const sinceClause = since ? `AND "updatedAt" > $2` : "";
      const params = since ? [userId, since] : [userId];
      const { rows } = await pool.query(
        `SELECT * FROM "${tableName}" WHERE "${filterKey}" = $1 ${sinceClause}`,
        params
      );
      return rows;
    } catch (err) {
      if (err.code === "42P01" || err.code === "42703") {
        console.warn(
          `[ScopeResolver] Query error on "${tableName}": ${err.message}`
        );
        return [];
      }
      throw err;
    }
  }

  async _poolQueryUsers(tableName, userId, adminWithPasswords, since) {
    try {
      const sinceClause = since ? `WHERE "updatedAt" > $1` : "";
      const params = since ? [since] : [];
      const { rows } = await pool.query(
        `SELECT * FROM "${tableName}" ${sinceClause}`,
        params
      );
      // Redact passwords unless this user is in adminWithPasswords list
      // Note: adminWithPasswords here is the ROLE not userId — handled at call site
      return rows.map((r) => {
        if (!adminWithPasswords) {
          r.password = "__redacted__";
        }
        return r;
      });
    } catch (err) {
      if (err.code === "42P01" || err.code === "42703") {
        console.warn(
          `[ScopeResolver] Query error on "${tableName}": ${err.message}`
        );
        return [];
      }
      throw err;
    }
  }

  async _poolQueryDisciplineCases(tableName, userId, role, since) {
    try {
      const fullRoles = [...ADMIN_ROLES, ROLES.DISCIPLINE, ROLES.PSYCHOSOCIAL];
      if (fullRoles.includes(role)) {
        return this._poolQueryAll(tableName, since);
      }
      const sinceClause = since ? `AND "updatedAt" > $2` : "";
      const params = since ? [userId, since] : [userId];
      const { rows } = await pool.query(
        `SELECT * FROM "${tableName}"
         WHERE (recorded_by = $1 OR teacher_id = $1)
         ${sinceClause}`,
        params
      );
      return rows;
    } catch (err) {
      if (err.code === "42P01" || err.code === "42703") {
        console.warn(
          `[ScopeResolver] Query error on "${tableName}": ${err.message}`
        );
        return [];
      }
      throw err;
    }
  }

  async _poolQueryGroups(tableName, userId, since) {
    try {
      // groups has created_at not updatedAt — use created_at for since
      const sinceClause = since ? `AND g.created_at > $2` : "";
      const params = since ? [userId, since] : [userId];
      const { rows } = await pool.query(
        `SELECT g.* FROM "${tableName}" g
         JOIN group_participants gp ON gp.group_id = g.id
         WHERE gp.user_id = $1
         ${sinceClause}`,
        params
      );
      return rows;
    } catch (err) {
      if (err.code === "42P01" || err.code === "42703") {
        console.warn(
          `[ScopeResolver] Query error on "${tableName}": ${err.message}`
        );
        return [];
      }
      throw err;
    }
  }

  async _poolQueryGroupParticipants(tableName, userId, since) {
    try {
      // group_participants has joined_at not updatedAt
      const sinceClause = since ? `AND gp.joined_at > $2` : "";
      const params = since ? [userId, since] : [userId];
      const { rows } = await pool.query(
        `SELECT gp.* FROM "${tableName}" gp
         WHERE gp.group_id IN (
           SELECT group_id FROM group_participants WHERE user_id = $1
         )
         ${sinceClause}`,
        params
      );
      return rows;
    } catch (err) {
      if (err.code === "42P01" || err.code === "42703") {
        console.warn(
          `[ScopeResolver] Query error on "${tableName}": ${err.message}`
        );
        return [];
      }
      throw err;
    }
  }

  async _poolQueryMessages(tableName, userId, since) {
    try {
      // messages has created_at not updatedAt
      const sinceClause = since ? `AND created_at > $2` : "";
      const params = since ? [userId, since] : [userId];

      const groupResult = await pool.query(
        `SELECT group_id FROM group_participants WHERE user_id = $1`,
        [userId]
      );
      const groupIds = groupResult.rows.map((r) => r.group_id).filter(Boolean);

      if (groupIds.length) {
        const gParams = since ? [userId, since, groupIds] : [userId, groupIds];
        const gSince = since ? `AND created_at > $2` : "";
        const gGroupIdx = since ? "$3" : "$2";
        const { rows } = await pool.query(
          `SELECT * FROM "${tableName}"
           WHERE (sender_id = $1 OR receiver_id = $1 OR group_id = ANY(${gGroupIdx}))
           ${gSince}`,
          gParams
        );
        return rows;
      }

      const { rows } = await pool.query(
        `SELECT * FROM "${tableName}"
         WHERE (sender_id = $1 OR receiver_id = $1)
         ${sinceClause}`,
        params
      );
      return rows;
    } catch (err) {
      if (err.code === "42P01" || err.code === "42703") {
        console.warn(
          `[ScopeResolver] Query error on "${tableName}": ${err.message}`
        );
        return [];
      }
      throw err;
    }
  }

  // ── Main executor ──────────────────────────────────────────────────────────

  /**
   * Core method backing both resolve() and resolveDelta().
   * Iterates SCOPE_CONFIG, resolves the real table name for each entry,
   * and queries using pool with correct snake_case column names.
   *
   * @param {number} userId
   * @param {string} role
   * @param {Date|null} since  - null for full sync, Date for delta
   */
  async _execute(userId, role, since = null) {
    let classIds = [];
    let subjectIds = [];
    if (!FULL_ADMIN_ROLES.includes(role)) {
      ({ classIds, subjectIds } = await this._resolveClassScope(userId));
    }

    const isFullAdmin = FULL_ADMIN_ROLES.includes(role);
    const isAdminRole = ADMIN_ROLES.includes(role);
    const payload = {};

    for (const [key, config] of Object.entries(SCOPE_CONFIG)) {
      try {
        if (config.strategy === STRATEGY.NEVER) continue;

        // Resolve real PostgreSQL table name — this is the critical fix.
        // Previously this used config.model directly (e.g. "AcademicYear")
        // which doesn't exist as a table name in PostgreSQL.
        const tableName = this._resolveTableName(config);
        if (!tableName) {
          console.warn(
            `[ScopeResolver] Could not resolve table name for "${key}" — skipping`
          );
          continue;
        }

        // ── PUBLIC ──────────────────────────────────────────────────────────
        if (config.strategy === STRATEGY.PUBLIC) {
          // User table: redact passwords based on role
          if (key === "User") {
            const keepPasswords =
              config.customFilter?.adminWithPasswords?.includes(role) ?? false;
            payload[key] = await this._poolQueryUsers(
              tableName,
              userId,
              keepPasswords,
              since
            );
            continue;
          }
          payload[key] = await this._poolQueryAll(tableName, since);
          continue;
        }

        // ── FULL_FOR_ROLES ───────────────────────────────────────────────────
        if (config.strategy === STRATEGY.FULL_FOR_ROLES) {
          if (!config.allowedRoles.includes(role)) continue;
          payload[key] = await this._poolQueryAll(tableName, since);
          continue;
        }

        // ── OWNED ────────────────────────────────────────────────────────────
        if (config.strategy === STRATEGY.OWNED) {
          // DisciplineCase — custom role-based filter
          if (key === "DisciplineCase") {
            payload[key] = await this._poolQueryDisciplineCases(
              tableName,
              userId,
              role,
              since
            );
            continue;
          }

          // Group — user's own groups only
          if (key === "Group") {
            payload[key] = await this._poolQueryGroups(
              tableName,
              userId,
              since
            );
            continue;
          }

          // GroupParticipant — participants in user's groups only
          if (key === "GroupParticipant") {
            payload[key] = await this._poolQueryGroupParticipants(
              tableName,
              userId,
              since
            );
            continue;
          }

          // Message — sent, received, or in user's groups
          if (key === "Message") {
            payload[key] = await this._poolQueryMessages(
              tableName,
              userId,
              since
            );
            continue;
          }

          // Generic filterType dispatch
          const filterKey = config.filterKey || "class_id";

          switch (config.filterType) {
            case FILTER_TYPE.BY_CLASS_IDS:
              payload[key] = isFullAdmin
                ? await this._poolQueryAll(tableName, since)
                : isAdminRole
                ? await this._poolQueryAll(tableName, since)
                : await this._poolQueryByClassIds(
                    tableName,
                    filterKey,
                    classIds,
                    since
                  );
              break;

            case FILTER_TYPE.BY_SUBJECT_IDS:
              payload[key] = isFullAdmin
                ? await this._poolQueryAll(tableName, since)
                : await this._poolQueryBySubjectIds(
                    tableName,
                    subjectIds,
                    since
                  );
              break;

            case FILTER_TYPE.BY_CLASS_AND_SUBJECT:
              payload[key] = isFullAdmin
                ? await this._poolQueryAll(tableName, since)
                : await this._poolQueryByClassAndSubject(
                    tableName,
                    classIds,
                    subjectIds,
                    since
                  );
              break;

            case FILTER_TYPE.BY_USER_ID:
              payload[key] = isAdminRole
                ? await this._poolQueryAll(tableName, since)
                : await this._poolQueryByUserId(
                    tableName,
                    config.filterKey || "user_id",
                    userId,
                    since
                  );
              break;

            case FILTER_TYPE.BY_USER_ID_ONLY:
              payload[key] = await this._poolQueryByUserId(
                tableName,
                config.filterKey || "user_id",
                userId,
                since
              );
              break;

            default:
              console.warn(
                `[ScopeResolver] Unhandled filterType "${config.filterType}" for "${key}" — fetching all`
              );
              payload[key] = await this._poolQueryAll(tableName, since);
          }
        }
      } catch (err) {
        console.error(
          `[ScopeResolver] Failed resolving "${key}":`,
          err.message
        );
        // Don't throw — a single table failure should not abort the whole delta
        payload[key] = [];
      }
    }

    return payload;
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  async resolve(userId, role) {
    return this._execute(userId, role, null);
  }

  async resolveDelta(userId, role, since) {
    if (!since || !(since instanceof Date)) {
      throw new Error(
        "[ScopeResolver] resolveDelta requires a valid Date for `since`"
      );
    }
    return this._execute(userId, role, since);
  }

  // ── Manifest (count per table for legacy WebSocket flow) ───────────────────

  async resolveManifest(userId, role) {
    let classIds = [];
    let subjectIds = [];
    if (!FULL_ADMIN_ROLES.includes(role)) {
      ({ classIds, subjectIds } = await this._resolveClassScope(userId));
    }
    const isFullAdmin = FULL_ADMIN_ROLES.includes(role);
    const isAdminRole = ADMIN_ROLES.includes(role);

    const entries = Object.entries(SCOPE_CONFIG).filter(([, config]) => {
      if (config.strategy === STRATEGY.NEVER) return false;
      if (!config.model || !models[config.model]) return false;
      if (
        config.strategy === STRATEGY.FULL_FOR_ROLES &&
        !config.allowedRoles.includes(role)
      )
        return false;
      return true;
    });

    const results = await Promise.allSettled(
      entries.map(async ([key, config]) => {
        const tableName = this._resolveTableName(config);
        if (!tableName) return { key, count: 0 };

        let count = 0;
        try {
          if (
            config.strategy === STRATEGY.PUBLIC ||
            config.strategy === STRATEGY.FULL_FOR_ROLES
          ) {
            const { rows } = await pool.query(
              `SELECT COUNT(*) AS count FROM "${tableName}"`
            );
            count = parseInt(rows[0].count, 10) || 0;
          } else if (config.strategy === STRATEGY.OWNED) {
            count = await this._countOwned(
              key,
              config,
              tableName,
              userId,
              role,
              classIds,
              subjectIds,
              isFullAdmin,
              isAdminRole
            );
          }
        } catch (err) {
          console.error(
            `[ScopeResolver] Manifest count failed for "${key}":`,
            err.message
          );
        }
        return { key, count };
      })
    );

    const manifest = {};
    for (const result of results) {
      if (result.status === "fulfilled") {
        manifest[result.value.key] = result.value.count;
      } else {
        const idx = results.indexOf(result);
        const key = entries[idx]?.[0];
        if (key) manifest[key] = 0;
      }
    }
    return manifest;
  }

  async _countOwned(
    key,
    config,
    tableName,
    userId,
    role,
    classIds,
    subjectIds,
    isFullAdmin,
    isAdminRole
  ) {
    const countAll = async () => {
      const { rows } = await pool.query(
        `SELECT COUNT(*) AS count FROM "${tableName}"`
      );
      return parseInt(rows[0].count, 10) || 0;
    };
    const countWhere = async (whereClause, params) => {
      const { rows } = await pool.query(
        `SELECT COUNT(*) AS count FROM "${tableName}" WHERE ${whereClause}`,
        params
      );
      return parseInt(rows[0].count, 10) || 0;
    };

    if (key === "User") return countAll();

    if (key === "DisciplineCase") {
      const fullRoles = [...ADMIN_ROLES, ROLES.DISCIPLINE, ROLES.PSYCHOSOCIAL];
      if (fullRoles.includes(role)) return countAll();
      return countWhere("recorded_by = $1 OR teacher_id = $1", [userId]);
    }

    if (key === "Group") {
      const { rows } = await pool.query(
        `SELECT COUNT(DISTINCT g.id) AS count FROM "${tableName}" g
         JOIN group_participants gp ON gp.group_id = g.id
         WHERE gp.user_id = $1`,
        [userId]
      );
      return parseInt(rows[0].count, 10) || 0;
    }

    if (key === "GroupParticipant") {
      const { rows } = await pool.query(
        `SELECT COUNT(*) AS count FROM "${tableName}"
         WHERE group_id IN (
           SELECT group_id FROM group_participants WHERE user_id = $1
         )`,
        [userId]
      );
      return parseInt(rows[0].count, 10) || 0;
    }

    if (key === "Message") {
      const groupResult = await pool.query(
        `SELECT group_id FROM group_participants WHERE user_id = $1`,
        [userId]
      );
      const groupIds = groupResult.rows.map((r) => r.group_id).filter(Boolean);
      if (groupIds.length) {
        const { rows } = await pool.query(
          `SELECT COUNT(*) AS count FROM "${tableName}"
           WHERE sender_id = $1 OR receiver_id = $1 OR group_id = ANY($2)`,
          [userId, groupIds]
        );
        return parseInt(rows[0].count, 10) || 0;
      }
      return countWhere("sender_id = $1 OR receiver_id = $1", [userId]);
    }

    const filterKey = config.filterKey || "class_id";

    switch (config.filterType) {
      case FILTER_TYPE.BY_CLASS_IDS:
        if (isFullAdmin || isAdminRole) return countAll();
        if (!classIds.length) return 0;
        return countWhere(`"${filterKey}" = ANY($1)`, [classIds]);

      case FILTER_TYPE.BY_SUBJECT_IDS:
        if (isFullAdmin) return countAll();
        if (!subjectIds.length) return 0;
        return countWhere(`id = ANY($1)`, [subjectIds]);

      case FILTER_TYPE.BY_CLASS_AND_SUBJECT:
        if (isFullAdmin) return countAll();
        if (!classIds.length || !subjectIds.length) return 0;
        return countWhere(`class_id = ANY($1) AND subject_id = ANY($2)`, [
          classIds,
          subjectIds,
        ]);

      case FILTER_TYPE.BY_USER_ID:
        if (isAdminRole) return countAll();
        return countWhere(`"${config.filterKey || "user_id"}" = $1`, [userId]);

      case FILTER_TYPE.BY_USER_ID_ONLY:
        return countWhere(`"${config.filterKey || "user_id"}" = $1`, [userId]);

      default:
        return countAll();
    }
  }

  // ── resolveSlice (legacy WebSocket streaming) ──────────────────────────────

  async resolveSlice(userId, role, tableKey, offset, limit) {
    const config = SCOPE_CONFIG[tableKey];
    if (!config || config.strategy === STRATEGY.NEVER) return [];

    const tableName = this._resolveTableName(config);
    if (!tableName) return [];

    let classIds = [];
    let subjectIds = [];
    if (!FULL_ADMIN_ROLES.includes(role)) {
      ({ classIds, subjectIds } = await this._resolveClassScope(userId));
    }

    const isFullAdmin = FULL_ADMIN_ROLES.includes(role);
    const isAdminRole = ADMIN_ROLES.includes(role);

    const _model = models[config.model];
    const pkField = _model?.primaryKeyAttribute || "id";

    const poolQuery = async (whereClause = "", params = []) => {
      const pOff = params.length;
      const L = `$${pOff + 1}`;
      const O = `$${pOff + 2}`;
      const sql = `SELECT * FROM "${tableName}" ${whereClause} ORDER BY "${pkField}" LIMIT ${L} OFFSET ${O}`;
      try {
        const { rows } = await pool.query(sql, [...params, limit, offset]);
        return rows;
      } catch (err) {
        if (err.code === "42703") {
          // pkField column missing — retry without ORDER BY
          const fallback = `SELECT * FROM "${tableName}" ${whereClause} LIMIT ${L} OFFSET ${O}`;
          try {
            const { rows } = await pool.query(fallback, [
              ...params,
              limit,
              offset,
            ]);
            return rows;
          } catch (inner) {
            console.warn(
              `[ScopeResolver] Skipping "${tableName}": ${inner.message}`
            );
            return [];
          }
        }
        if (err.code === "42P01") {
          console.warn(
            `[ScopeResolver] Table "${tableName}" does not exist — skipping`
          );
          return [];
        }
        throw err;
      }
    };

    const poolQueryRaw = async (sql, params = []) => {
      try {
        const { rows } = await pool.query(sql, params);
        return rows;
      } catch (err) {
        if (err.code === "42703" || err.code === "42P01") {
          console.warn(
            `[ScopeResolver] Query error for "${tableKey}": ${err.message}`
          );
          return [];
        }
        throw err;
      }
    };

    if (config.strategy === STRATEGY.PUBLIC) {
      if (tableKey === "User") {
        const keepPasswords =
          config.customFilter?.adminWithPasswords?.includes(role) ?? false;
        const rows = await poolQuery();
        return rows.map((r) => {
          if (!keepPasswords) r.password = "__redacted__";
          return r;
        });
      }
      return poolQuery();
    }

    if (config.strategy === STRATEGY.FULL_FOR_ROLES) {
      if (!config.allowedRoles.includes(role)) return [];
      return poolQuery();
    }

    // OWNED special cases
    if (tableKey === "DisciplineCase") {
      const fullRoles = [...ADMIN_ROLES, ROLES.DISCIPLINE, ROLES.PSYCHOSOCIAL];
      if (fullRoles.includes(role)) return poolQuery();
      return poolQueryRaw(
        `SELECT * FROM "${tableName}"
         WHERE (recorded_by = $1 OR teacher_id = $1)
         ORDER BY id LIMIT $2 OFFSET $3`,
        [userId, limit, offset]
      );
    }

    if (tableKey === "Group") {
      return poolQueryRaw(
        `SELECT g.* FROM "${tableName}" g
         JOIN group_participants gp ON gp.group_id = g.id
         WHERE gp.user_id = $1
         ORDER BY g.id LIMIT $2 OFFSET $3`,
        [userId, limit, offset]
      );
    }

    if (tableKey === "GroupParticipant") {
      return poolQueryRaw(
        `SELECT gp.* FROM "${tableName}" gp
         WHERE gp.group_id IN (
           SELECT group_id FROM group_participants WHERE user_id = $1
         )
         ORDER BY gp.id LIMIT $2 OFFSET $3`,
        [userId, limit, offset]
      );
    }

    if (tableKey === "Message") {
      const groupResult = await poolQueryRaw(
        `SELECT group_id FROM group_participants WHERE user_id = $1`,
        [userId]
      );
      const groupIds = groupResult.map((r) => r.group_id).filter(Boolean);
      if (groupIds.length) {
        return poolQueryRaw(
          `SELECT * FROM "${tableName}"
           WHERE sender_id = $1 OR receiver_id = $1 OR group_id = ANY($2)
           ORDER BY id LIMIT $3 OFFSET $4`,
          [userId, groupIds, limit, offset]
        );
      }
      return poolQueryRaw(
        `SELECT * FROM "${tableName}"
         WHERE sender_id = $1 OR receiver_id = $1
         ORDER BY id LIMIT $2 OFFSET $3`,
        [userId, limit, offset]
      );
    }

    // Generic filterType
    const filterKey = config.filterKey || "class_id";

    switch (config.filterType) {
      case FILTER_TYPE.BY_CLASS_IDS:
        if (isFullAdmin || isAdminRole) return poolQuery();
        if (!classIds.length) return [];
        return poolQuery(`WHERE "${filterKey}" = ANY($1)`, [classIds]);

      case FILTER_TYPE.BY_SUBJECT_IDS:
        if (isFullAdmin) return poolQuery();
        if (!subjectIds.length) return [];
        return poolQuery(`WHERE id = ANY($1)`, [subjectIds]);

      case FILTER_TYPE.BY_CLASS_AND_SUBJECT:
        if (isFullAdmin) return poolQuery();
        if (!classIds.length || !subjectIds.length) return [];
        return poolQuery(`WHERE class_id = ANY($1) AND subject_id = ANY($2)`, [
          classIds,
          subjectIds,
        ]);

      case FILTER_TYPE.BY_USER_ID:
        if (isAdminRole) return poolQuery();
        return poolQuery(`WHERE "${config.filterKey || "user_id"}" = $1`, [
          userId,
        ]);

      case FILTER_TYPE.BY_USER_ID_ONLY:
        return poolQuery(`WHERE "${config.filterKey || "user_id"}" = $1`, [
          userId,
        ]);

      default:
        console.warn(
          `[ScopeResolver] Unknown filterType "${config.filterType}" for "${tableKey}"`
        );
        return poolQuery();
    }
  }
}

module.exports = ScopeResolver;
