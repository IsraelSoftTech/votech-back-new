"use strict";

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
  async _resolveClassScope(userId) {
    const rows = await sequelize.query(
      `
      SELECT DISTINCT cs."classId", cs."subjectId"
      FROM class_subjects cs
      WHERE cs."teacherId" = :userId

      UNION

      SELECT DISTINCT ta."classId", NULL AS "subjectId"
      FROM teacher_assignments ta
      WHERE ta."teacherId" = :userId
      `,
      {
        replacements: { userId },
        type: QueryTypes.SELECT,
      }
    );

    const classIds = [...new Set(rows.map((r) => r.classId).filter(Boolean))];
    const subjectIds = [
      ...new Set(rows.map((r) => r.subjectId).filter(Boolean)),
    ];

    return { classIds, subjectIds };
  }

  async _queryAll(table, since) {
    if (since) {
      return sequelize.query(
        `SELECT * FROM "${table}" WHERE "updatedAt" > :since`,
        { replacements: { since }, type: QueryTypes.SELECT }
      );
    }
    return sequelize.query(`SELECT * FROM "${table}"`, {
      type: QueryTypes.SELECT,
    });
  }

  async _queryByClassIds(table, filterKey, classIds, since) {
    if (!classIds.length) return [];
    const sinceClause = since ? `AND "updatedAt" > :since` : "";
    return sequelize.query(
      `SELECT * FROM "${table}" WHERE "${filterKey}" = ANY(:classIds) ${sinceClause}`,
      { replacements: { classIds, since }, type: QueryTypes.SELECT }
    );
  }

  async _queryBySubjectIds(table, subjectIds, since) {
    if (!subjectIds.length) return [];
    const sinceClause = since ? `AND "updatedAt" > :since` : "";
    return sequelize.query(
      `SELECT * FROM "${table}" WHERE "id" = ANY(:subjectIds) ${sinceClause}`,
      { replacements: { subjectIds, since }, type: QueryTypes.SELECT }
    );
  }

  async _queryByClassAndSubject(table, classIds, subjectIds, since) {
    if (!classIds.length || !subjectIds.length) return [];
    const sinceClause = since ? `AND "updatedAt" > :since` : "";
    return sequelize.query(
      `
      SELECT * FROM "${table}"
      WHERE "classId" = ANY(:classIds)
        AND "subjectId" = ANY(:subjectIds)
        ${sinceClause}
      `,
      { replacements: { classIds, subjectIds, since }, type: QueryTypes.SELECT }
    );
  }

  async _queryByUserId(table, filterKey, userId, since) {
    const sinceClause = since ? `AND "updatedAt" > :since` : "";
    return sequelize.query(
      `SELECT * FROM "${table}" WHERE "${filterKey}" = :userId ${sinceClause}`,
      { replacements: { userId, since }, type: QueryTypes.SELECT }
    );
  }

  async _queryAttendanceRecords(classIds, since) {
    if (!classIds.length) return [];
    const sinceClause = since ? `AND ar."updatedAt" > :since` : "";
    return sequelize.query(
      `
      SELECT ar.* FROM attendance_records ar
      JOIN attendance_sessions s ON s.id = ar."sessionId"
      WHERE s."classId" = ANY(:classIds)
      ${sinceClause}
      `,
      { replacements: { classIds, since }, type: QueryTypes.SELECT }
    );
  }

  async _queryFees(classIds, since) {
    if (!classIds.length) return [];
    const sinceClause = since ? `AND f."updatedAt" > :since` : "";
    return sequelize.query(
      `
      SELECT f.* FROM fees f
      JOIN students s ON s.id = f."studentId"
      WHERE s."classId" = ANY(:classIds)
      ${sinceClause}
      `,
      { replacements: { classIds, since }, type: QueryTypes.SELECT }
    );
  }

  async _querySpecialties(classIds, since) {
    if (!classIds.length) return [];
    const sinceClause = since ? `AND sp."updatedAt" > :since` : "";
    return sequelize.query(
      `
      SELECT DISTINCT sp.* FROM specialties sp
      JOIN specialty_classes sc ON sc."specialtyId" = sp.id
      WHERE sc."classId" = ANY(:classIds)
      ${sinceClause}
      `,
      { replacements: { classIds, since }, type: QueryTypes.SELECT }
    );
  }

  async _queryGroups(userId, since) {
    const sinceClause = since ? `AND g."createdAt" > :since` : "";
    return sequelize.query(
      `
      SELECT g.* FROM groups g
      JOIN group_participants gp ON gp."groupId" = g.id
      WHERE gp."userId" = :userId
      ${sinceClause}
      `,
      { replacements: { userId, since }, type: QueryTypes.SELECT }
    );
  }

  async _queryGroupParticipants(userId, since) {
    const sinceClause = since ? `AND gp."joinedAt" > :since` : "";
    return sequelize.query(
      `
      SELECT gp.* FROM group_participants gp
      WHERE gp."groupId" IN (
        SELECT "groupId" FROM group_participants WHERE "userId" = :userId
      )
      ${sinceClause}
      `,
      { replacements: { userId, since }, type: QueryTypes.SELECT }
    );
  }

  async _queryMessages(userId, since) {
    const sinceClause = since ? `AND "createdAt" > :since` : "";
    return sequelize.query(
      `
      SELECT * FROM messages
      WHERE (
        "senderId"   = :userId
        OR "receiverId" = :userId
        OR "groupId" IN (
          SELECT "groupId" FROM group_participants WHERE "userId" = :userId
        )
      )
      ${sinceClause}
      `,
      { replacements: { userId, since }, type: QueryTypes.SELECT }
    );
  }

  async _queryUsers(since) {
    const sinceClause = since ? `WHERE "updatedAt" > :since` : "";
    return sequelize.query(`SELECT * FROM users ${sinceClause}`, {
      replacements: { since },
      type: QueryTypes.SELECT,
    });
  }

  async _queryDisciplineCases(userId, role, since) {
    const sinceClause = since ? `AND "updatedAt" > :since` : "";
    const fullRoles = [...ADMIN_ROLES, ROLES.DISCIPLINE, ROLES.PSYCHOSOCIAL];
    if (fullRoles.includes(role)) {
      const whereClause = since ? `WHERE "updatedAt" > :since` : "";
      return sequelize.query(`SELECT * FROM discipline_cases ${whereClause}`, {
        replacements: { since },
        type: QueryTypes.SELECT,
      });
    }
    return sequelize.query(
      `SELECT * FROM discipline_cases
       WHERE ("recordedBy" = :userId OR "teacherId" = :userId)
       ${sinceClause}`,
      { replacements: { userId, since }, type: QueryTypes.SELECT }
    );
  }

  // ── Main resolver (_execute) ───────────────────────────────────────────────

  async _execute(userId, role, since = null) {
    let classIds = [];
    let subjectIds = [];
    if (!FULL_ADMIN_ROLES.includes(role)) {
      ({ classIds, subjectIds } = await this._resolveClassScope(userId));
    }

    const payload = {};
    const isFullAdmin = FULL_ADMIN_ROLES.includes(role);
    const isAdminRole = ADMIN_ROLES.includes(role);

    for (const [key, config] of Object.entries(SCOPE_CONFIG)) {
      try {
        if (config.strategy === STRATEGY.NEVER) continue;
        if (config.strategy === STRATEGY.PUBLIC) {
          payload[key] = await this._queryAll(config.model, since);
          continue;
        }
        if (config.strategy === STRATEGY.FULL_FOR_ROLES) {
          if (!config.allowedRoles.includes(role)) continue;
          payload[key] = await this._queryAll(config.model, since);
          continue;
        }
        if (config.strategy === STRATEGY.OWNED) {
          if (key === "User") {
            payload[key] = await this._queryUsers(since);
            continue;
          }
          if (key === "DisciplineCase") {
            payload[key] = await this._queryDisciplineCases(
              userId,
              role,
              since
            );
            continue;
          }
          if (key === "Specialty") {
            payload[key] = isFullAdmin
              ? await this._queryAll("specialties", since)
              : await this._querySpecialties(classIds, since);
            continue;
          }
          if (key === "Group") {
            payload[key] = await this._queryGroups(userId, since);
            continue;
          }
          if (key === "GroupParticipant") {
            payload[key] = await this._queryGroupParticipants(userId, since);
            continue;
          }
          if (key === "Message") {
            payload[key] = await this._queryMessages(userId, since);
            continue;
          }
          if (key === "AttendanceRecord") {
            payload[key] = isFullAdmin
              ? await this._queryAll("attendance_records", since)
              : await this._queryAttendanceRecords(classIds, since);
            continue;
          }
          if (key === "Fee") {
            payload[key] = isAdminRole
              ? await this._queryAll("fees", since)
              : await this._queryFees(classIds, since);
            continue;
          }

          switch (config.filterType) {
            case FILTER_TYPE.BY_CLASS_IDS:
              payload[key] = isFullAdmin
                ? await this._queryAll(config.model, since)
                : await this._queryByClassIds(
                    config.model,
                    config.filterKey || "classId",
                    classIds,
                    since
                  );
              break;
            case FILTER_TYPE.BY_SUBJECT_IDS:
              payload[key] = isFullAdmin
                ? await this._queryAll(config.model, since)
                : await this._queryBySubjectIds(
                    config.model,
                    subjectIds,
                    since
                  );
              break;
            case FILTER_TYPE.BY_CLASS_AND_SUBJECT:
              payload[key] = isFullAdmin
                ? await this._queryAll(config.model, since)
                : await this._queryByClassAndSubject(
                    config.model,
                    classIds,
                    subjectIds,
                    since
                  );
              break;
            case FILTER_TYPE.BY_USER_ID:
              payload[key] = isAdminRole
                ? await this._queryAll(config.model, since)
                : await this._queryByUserId(
                    config.model,
                    config.filterKey || "userId",
                    userId,
                    since
                  );
              break;
            case FILTER_TYPE.BY_USER_ID_ONLY:
              payload[key] = await this._queryByUserId(
                config.model,
                config.filterKey || "userId",
                userId,
                since
              );
              break;
            default:
              console.warn(
                `[ScopeResolver] Unhandled filterType "${config.filterType}" for key "${key}"`
              );
              break;
          }
        }
      } catch (err) {
        console.error(
          `[ScopeResolver] Failed resolving "${key}":`,
          err.message
        );
        throw err;
      }
    }
    return payload;
  }

  async resolve(userId, role) {
    return this._execute(userId, role, null);
  }

  async resolveDelta(userId, role, since) {
    if (!since || !(since instanceof Date))
      throw new Error(
        "[ScopeResolver] resolveDelta requires a valid Date for `since`"
      );
    return this._execute(userId, role, since);
  }

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
      if (config.model && !models[config.model]) return false;
      if (
        config.strategy === STRATEGY.FULL_FOR_ROLES &&
        !config.allowedRoles.includes(role)
      )
        return false;
      return true;
    });

    const results = await Promise.allSettled(
      entries.map(async ([key, config]) => {
        let count = 0;
        if (
          config.strategy === STRATEGY.PUBLIC ||
          config.strategy === STRATEGY.FULL_FOR_ROLES
        ) {
          count = await models[config.model].count();
        } else if (config.strategy === STRATEGY.OWNED) {
          count =
            (await this._countOwned(
              key,
              config,
              userId,
              role,
              classIds,
              subjectIds,
              isFullAdmin,
              isAdminRole
            )) || 0;
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
        const key = entries[idx][0];
        console.error(
          `[ScopeResolver] Manifest failed for "${key}":`,
          result.reason?.message
        );
        manifest[key] = 0;
      }
    }
    return manifest;
  }

  async _countOwned(
    key,
    config,
    userId,
    role,
    classIds,
    subjectIds,
    isFullAdmin,
    isAdminRole
  ) {
    const { Op } = require("sequelize");
    const m = (name) => models[name];

    if (key === "User") return m("User").count();
    if (key === "DisciplineCase") {
      const fullRoles = [...ADMIN_ROLES, ROLES.DISCIPLINE, ROLES.PSYCHOSOCIAL];
      if (fullRoles.includes(role)) return m("DisciplineCase").count();
      return m("DisciplineCase").count({
        where: { [Op.or]: [{ recordedBy: userId }, { teacherId: userId }] },
      });
    }
    if (key === "Specialty") {
      if (isFullAdmin) return m("Specialty").count();
      if (!classIds.length) return 0;
      return m("Specialty").count({
        include: [
          {
            model: m("SpecialtyClass"),
            as: "specialtyClasses",
            where: { classId: { [Op.in]: classIds } },
            required: true,
          },
        ],
        distinct: true,
      });
    }
    if (key === "Group") {
      return m("Group").count({
        include: [
          {
            model: m("GroupParticipant"),
            as: "participants",
            where: { userId },
            required: true,
          },
        ],
        distinct: true,
      });
    }
    if (key === "GroupParticipant") {
      const userGroups = await m("GroupParticipant").findAll({
        attributes: ["groupId"],
        where: { userId },
      });
      const groupIds = userGroups.map((r) => r.groupId);
      if (!groupIds.length) return 0;
      return m("GroupParticipant").count({
        where: { groupId: { [Op.in]: groupIds } },
      });
    }
    if (key === "Message") {
      const userGroups = await m("GroupParticipant").findAll({
        attributes: ["groupId"],
        where: { userId },
      });
      const groupIds = userGroups.map((r) => r.groupId);
      return m("Message").count({
        where: {
          [Op.or]: [
            { senderId: userId },
            { receiverId: userId },
            ...(groupIds.length ? [{ groupId: { [Op.in]: groupIds } }] : []),
          ],
        },
      });
    }
    if (key === "AttendanceRecord") {
      if (isFullAdmin) return m("AttendanceRecord").count();
      if (!classIds.length) return 0;
      return m("AttendanceRecord").count({
        include: [
          {
            model: m("AttendanceSession"),
            as: "session",
            where: { classId: { [Op.in]: classIds } },
            required: true,
          },
        ],
      });
    }
    if (key === "Fee") {
      if (isAdminRole) return m("Fee").count();
      if (!classIds.length) return 0;
      return m("Fee").count({
        include: [
          {
            model: m("Student"),
            as: "student",
            where: { classId: { [Op.in]: classIds } },
            required: true,
          },
        ],
      });
    }

    const model = m(config.model);
    const filterKey = config.filterKey || "classId";
    switch (config.filterType) {
      case FILTER_TYPE.BY_CLASS_IDS:
        if (isFullAdmin) return model.count();
        if (!classIds.length) return 0;
        return model.count({ where: { [filterKey]: { [Op.in]: classIds } } });
      case FILTER_TYPE.BY_SUBJECT_IDS:
        if (isFullAdmin) return model.count();
        if (!subjectIds.length) return 0;
        return model.count({ where: { id: { [Op.in]: subjectIds } } });
      case FILTER_TYPE.BY_CLASS_AND_SUBJECT:
        if (isFullAdmin) return model.count();
        if (!classIds.length || !subjectIds.length) return 0;
        return model.count({
          where: {
            classId: { [Op.in]: classIds },
            subjectId: { [Op.in]: subjectIds },
          },
        });
      case FILTER_TYPE.BY_USER_ID:
        if (isAdminRole) return model.count();
        return model.count({
          where: { [config.filterKey || "userId"]: userId },
        });
      case FILTER_TYPE.BY_USER_ID_ONLY:
        return model.count({
          where: { [config.filterKey || "userId"]: userId },
        });
      default:
        return null;
    }
  }

  // ══════════════════════════════════════════════════════════════════════════
  //  resolveSlice — 100% pool queries, actual DB column names, full fallbacks
  // ══════════════════════════════════════════════════════════════════════════

  /**
   * Resolve the actual PostgreSQL table name from a Sequelize model.
   * Handles: string return, { tableName, schema } object return, missing model.
   */
  _resolveTableName(config) {
    const _model = models[config.model];
    if (!_model) return config.model;

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

  async resolveSlice(userId, role, tableKey, offset, limit) {
    const {
      SCOPE_CONFIG,
      STRATEGY,
      FILTER_TYPE,
      ROLES,
      ADMIN_ROLES,
      FULL_ADMIN_ROLES,
    } = require("./scopeConfig");

    const config = SCOPE_CONFIG[tableKey];
    if (!config || config.strategy === STRATEGY.NEVER) return [];

    // ── Shared variables for ALL branches ──────────────────────────────────
    const _model = models[config.model];
    const tableName = this._resolveTableName(config);
    const pkField = _model?.primaryKeyAttribute || null;

    let classIds = [];
    let subjectIds = [];
    if (!FULL_ADMIN_ROLES.includes(role)) {
      ({ classIds, subjectIds } = await this._resolveClassScope(userId));
    }

    const isFullAdmin = FULL_ADMIN_ROLES.includes(role);
    const isAdminRole = ADMIN_ROLES.includes(role);

    // ── Pool query: SELECT * with optional WHERE, ORDER BY, LIMIT/OFFSET ──
    // Fallbacks: 42703 (column missing) → retry without ORDER BY → skip
    //            42P01 (table missing) → skip
    const poolQuery = async (whereClause = "", params = []) => {
      const pOff = params.length;
      const L = `$${pOff + 1}`;
      const O = `$${pOff + 2}`;
      const orderClause = pkField ? `ORDER BY "${pkField}"` : "";
      const sql = `SELECT * FROM "${tableName}" ${whereClause} ${orderClause} LIMIT ${L} OFFSET ${O}`;

      try {
        const { rows } = await pool.query(sql, [...params, limit, offset]);
        // console.log(rows);
        return rows;
      } catch (err) {
        if (err.code === "42703") {
          console.warn(
            `[ScopeResolver] Column error on "${tableName}" (${tableKey}): ${err.message} — retrying without ORDER BY`
          );
          const fallback = `SELECT * FROM "${tableName}" ${whereClause} LIMIT ${L} OFFSET ${O}`;
          try {
            const { rows } = await pool.query(fallback, [
              ...params,
              limit,
              offset,
            ]);
            return rows;
          } catch (inner) {
            if (inner.code === "42703" || inner.code === "42P01") {
              console.warn(
                `[ScopeResolver] Skipping "${tableName}" (${tableKey}): ${inner.message}`
              );
              return [];
            }
            throw inner;
          }
        }
        if (err.code === "42P01") {
          console.warn(
            `[ScopeResolver] Table "${tableName}" (${tableKey}) does not exist — skipping`
          );
          return [];
        }
        throw err;
      }
    };

    // ── Pool query: raw SQL for JOINs ─────────────────────────────────────
    const poolQueryRaw = async (sql, params = []) => {
      try {
        const { rows } = await pool.query(sql, params);
        return rows;
      } catch (err) {
        if (err.code === "42703" || err.code === "42P01") {
          console.warn(
            `[ScopeResolver] Query error for "${tableKey}": ${err.message} — skipping`
          );
          return [];
        }
        throw err;
      }
    };

    // ══════════════════════════════════════════════════════════════════════
    //  PUBLIC
    // ══════════════════════════════════════════════════════════════════════
    if (config.strategy === STRATEGY.PUBLIC) {
      return poolQuery();
    }

    // ══════════════════════════════════════════════════════════════════════
    //  FULL FOR ROLES
    // ══════════════════════════════════════════════════════════════════════
    if (config.strategy === STRATEGY.FULL_FOR_ROLES) {
      if (!config.allowedRoles.includes(role)) return [];
      return poolQuery();
    }

    // ══════════════════════════════════════════════════════════════════════
    //  OWNED — special cases (verified DB column names)
    // ══════════════════════════════════════════════════════════════════════

    // ── users ─────────────────────────────────────────────────────────────
    // DB cols: id, username, contact, password, name, email, gender, role,
    //          suspended, created_at, createdAt, updatedAt, profile_image_url,
    //          updatedBy, deviceId, scopeVersion
    if (tableKey === "User") {
      const rows = await poolQuery();
      return rows.map((r) => {
        if (r.id !== userId) delete r.password;
        return r;
      });
    }

    // ── discipline_cases ──────────────────────────────────────────────────
    // DB cols: recorded_by, teacher_id (snake_case confirmed)
    if (tableKey === "DisciplineCase") {
      const fullRoles = [...ADMIN_ROLES, ROLES.DISCIPLINE, ROLES.PSYCHOSOCIAL];
      if (fullRoles.includes(role)) return poolQuery();
      return poolQueryRaw(
        `SELECT * FROM "${tableName}"
         WHERE (recorded_by = $1 OR teacher_id = $1)
         LIMIT $2 OFFSET $3`,
        [userId, limit, offset]
      );
    }

    // ── specialties via specialty_classes ──────────────────────────────────
    // DB: specialty_classes(specialty_id, class_id)
    if (tableKey === "Specialty") {
      if (isFullAdmin) return poolQuery();
      if (!classIds.length) return [];
      return poolQueryRaw(
        `SELECT DISTINCT sp.* FROM "${tableName}" sp
         JOIN specialty_classes sc ON sc.specialty_id = sp.id
         WHERE sc.class_id = ANY($1)
         LIMIT $2 OFFSET $3`,
        [classIds, limit, offset]
      );
    }

    // ── groups via group_participants ──────────────────────────────────────
    // DB: group_participants(id, group_id, user_id, joined_at)
    if (tableKey === "Group") {
      return poolQueryRaw(
        `SELECT g.* FROM "${tableName}" g
         JOIN group_participants gp ON gp.group_id = g.id
         WHERE gp.user_id = $1
         LIMIT $2 OFFSET $3`,
        [userId, limit, offset]
      );
    }

    // ── group_participants ────────────────────────────────────────────────
    if (tableKey === "GroupParticipant") {
      return poolQueryRaw(
        `SELECT gp.* FROM "${tableName}" gp
         WHERE gp.group_id IN (
           SELECT group_id FROM group_participants WHERE user_id = $1
         )
         LIMIT $2 OFFSET $3`,
        [userId, limit, offset]
      );
    }

    // ── messages ─────────────────────────────────────────────────────────
    // DB: messages(sender_id, receiver_id, group_id)
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
           LIMIT $3 OFFSET $4`,
          [userId, groupIds, limit, offset]
        );
      }
      return poolQueryRaw(
        `SELECT * FROM "${tableName}"
         WHERE sender_id = $1 OR receiver_id = $1
         LIMIT $2 OFFSET $3`,
        [userId, limit, offset]
      );
    }

    // ── attendance_records via attendance_sessions ────────────────────────
    // DB: attendance_records(session_id), attendance_sessions(class_id)
    if (tableKey === "AttendanceRecord") {
      if (isFullAdmin) return poolQuery();
      if (!classIds.length) return [];
      return poolQueryRaw(
        `SELECT ar.* FROM "${tableName}" ar
         JOIN attendance_sessions s ON s.id = ar.session_id
         WHERE s.class_id = ANY($1)
         LIMIT $2 OFFSET $3`,
        [classIds, limit, offset]
      );
    }

    // ── fees via students ────────────────────────────────────────────────
    // DB: fees(student_id), students(class_id)
    if (tableKey === "Fee") {
      if (isAdminRole) return poolQuery();
      if (!classIds.length) return [];
      return poolQueryRaw(
        `SELECT f.* FROM "${tableName}" f
         JOIN students s ON s.id = f.student_id
         WHERE s.class_id = ANY($1)
         LIMIT $2 OFFSET $3`,
        [classIds, limit, offset]
      );
    }

    // ══════════════════════════════════════════════════════════════════════
    //  OWNED — generic filterType (all pool, snake_case DB column names)
    // ══════════════════════════════════════════════════════════════════════

    const filterKey = config.filterKey || "class_id";

    switch (config.filterType) {
      case FILTER_TYPE.BY_CLASS_IDS:
        if (isFullAdmin) return poolQuery();
        if (!classIds.length) return [];
        return poolQuery(`WHERE "${filterKey}" = ANY($1)`, [classIds]);

      case FILTER_TYPE.BY_SUBJECT_IDS:
        if (isFullAdmin) return poolQuery();
        if (!subjectIds.length) return [];
        return poolQuery(`WHERE "id" = ANY($1)`, [subjectIds]);

      case FILTER_TYPE.BY_CLASS_AND_SUBJECT:
        if (isFullAdmin) return poolQuery();
        if (!classIds.length || !subjectIds.length) return [];
        return poolQuery(
          `WHERE "class_id" = ANY($1) AND "subject_id" = ANY($2)`,
          [classIds, subjectIds]
        );

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
          `[ScopeResolver] Unknown filterType "${config.filterType}" for "${tableKey}" — returning full table`
        );
        return poolQuery();
    }
  }
}

module.exports = ScopeResolver;
