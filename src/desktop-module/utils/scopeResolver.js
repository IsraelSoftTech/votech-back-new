"use strict";

const { QueryTypes } = require("sequelize");
const { sequelize } = require("../../models/index.model");
const {
  ROLES,
  ADMIN_ROLES,
  FULL_ADMIN_ROLES,
  STRATEGY,
  FILTER_TYPE,
  SCOPE_CONFIG,
} = require("./scopeConfig");

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

  // users — all roles get the full list but password is ALWAYS stripped
  async _queryUsers(since) {
    const sinceClause = since ? `WHERE "updatedAt" > :since` : "";
    return sequelize.query(`SELECT * FROM users ${sinceClause}`, {
      replacements: { since },
      type: QueryTypes.SELECT,
    });
  }

  // discipline_cases — role-specific logic
  async _queryDisciplineCases(userId, role, since) {
    const sinceClause = since ? `AND "updatedAt" > :since` : "";

    // Admin, Discipline, Psychosocial — full table
    const fullRoles = [...ADMIN_ROLES, ROLES.DISCIPLINE, ROLES.PSYCHOSOCIAL];
    if (fullRoles.includes(role)) {
      const whereClause = since ? `WHERE "updatedAt" > :since` : "";
      return sequelize.query(`SELECT * FROM discipline_cases ${whereClause}`, {
        replacements: { since },
        type: QueryTypes.SELECT,
      });
    }

    // Teacher — own records only (recorded by them or assigned to them)
    return sequelize.query(
      `
      SELECT * FROM discipline_cases
      WHERE ("recordedBy" = :userId OR "teacherId" = :userId)
      ${sinceClause}
      `,
      { replacements: { userId, since }, type: QueryTypes.SELECT }
    );
  }

  // ── Main resolver ──────────────────────────────────────────────────────────

  async _execute(userId, role, since = null) {
    // Step 1: resolve class scope (skip for full admins — they get everything)
    let classIds = [];
    let subjectIds = [];

    if (!FULL_ADMIN_ROLES.includes(role)) {
      ({ classIds, subjectIds } = await this._resolveClassScope(userId));
    }

    const payload = {};
    const isFullAdmin = FULL_ADMIN_ROLES.includes(role);
    const isAdminRole = ADMIN_ROLES.includes(role);

    // Step 2: iterate config and resolve each table
    for (const [key, config] of Object.entries(SCOPE_CONFIG)) {
      try {
        // ── NEVER ──────────────────────────────────────────────────────────
        if (config.strategy === STRATEGY.NEVER) {
          // excluded — not added to payload at all
          continue;
        }

        // ── PUBLIC ─────────────────────────────────────────────────────────
        if (config.strategy === STRATEGY.PUBLIC) {
          payload[key] = await this._queryAll(config.model, since);
          continue;
        }

        // ── FULL FOR ROLES ─────────────────────────────────────────────────
        if (config.strategy === STRATEGY.FULL_FOR_ROLES) {
          if (!config.allowedRoles.includes(role)) {
            // silently excluded — key not added to payload
            continue;
          }
          payload[key] = await this._queryAll(config.model, since);
          continue;
        }

        // ── OWNED ──────────────────────────────────────────────────────────
        if (config.strategy === STRATEGY.OWNED) {
          // Special cases first
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

          // Generic OWNED — handled by filterType
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
              // Admins get full table, others get own rows only
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
              // No admin override — everyone gets own rows only
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

  // ── Public API ─────────────────────────────────────────────────────────────

  // Initial sync — full payload, no time filter
  async resolve(userId, role) {
    return this._execute(userId, role, null);
  }

  // Delta sync — same scope rules, only rows changed since the given date
  async resolveDelta(userId, role, since) {
    if (!since || !(since instanceof Date)) {
      throw new Error(
        "[ScopeResolver] resolveDelta requires a valid Date for `since`"
      );
    }
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
    const manifest = {};

    for (const [key, config] of Object.entries(SCOPE_CONFIG)) {
      try {
        if (config.strategy === STRATEGY.NEVER) continue;

        if (config.strategy === STRATEGY.PUBLIC) {
          manifest[key] = await sequelize.models[config.model].count();
          continue;
        }

        if (config.strategy === STRATEGY.FULL_FOR_ROLES) {
          if (!config.allowedRoles.includes(role)) continue;
          manifest[key] = await sequelize.models[config.model].count();
          continue;
        }

        if (config.strategy === STRATEGY.OWNED) {
          const count = await this._countOwned(
            key,
            config,
            userId,
            role,
            classIds,
            subjectIds,
            isFullAdmin,
            isAdminRole
          );
          if (count !== null) manifest[key] = count;
        }
      } catch (err) {
        console.error(
          `[ScopeResolver] Manifest count failed for "${key}":`,
          err.message
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
    const m = (name) => sequelize.models[name];

    if (key === "User") {
      return m("User").count();
    }

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
          { model: m("GroupParticipant"), where: { userId }, required: true },
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
            where: { classId: { [Op.in]: classIds } },
            required: true,
          },
        ],
      });
    }

    // ── Generic filterType ───────────────────────────────────────────────────
    const { Op: O } = require("sequelize");
    const model = m(config.model);
    const filterKey = config.filterKey || "classId";

    switch (config.filterType) {
      case FILTER_TYPE.BY_CLASS_IDS:
        if (isFullAdmin) return model.count();
        if (!classIds.length) return 0;
        return model.count({ where: { [filterKey]: { [O.in]: classIds } } });

      case FILTER_TYPE.BY_SUBJECT_IDS:
        if (isFullAdmin) return model.count();
        if (!subjectIds.length) return 0;
        return model.count({ where: { id: { [O.in]: subjectIds } } });

      case FILTER_TYPE.BY_CLASS_AND_SUBJECT:
        if (isFullAdmin) return model.count();
        if (!classIds.length || !subjectIds.length) return 0;
        return model.count({
          where: {
            classId: { [O.in]: classIds },
            subjectId: { [O.in]: subjectIds },
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

  async resolveSlice(userId, role, tableKey, offset, limit) {
    const {
      SCOPE_CONFIG,
      STRATEGY,
      FILTER_TYPE,
      ROLES,
      ADMIN_ROLES,
      FULL_ADMIN_ROLES,
    } = require("./scopeConfig");
    const { Op } = require("sequelize");

    const config = SCOPE_CONFIG[tableKey];
    if (!config || config.strategy === STRATEGY.NEVER) return [];

    let classIds = [];
    let subjectIds = [];

    if (!FULL_ADMIN_ROLES.includes(role)) {
      ({ classIds, subjectIds } = await this._resolveClassScope(userId));
    }

    const isFullAdmin = FULL_ADMIN_ROLES.includes(role);
    const isAdminRole = ADMIN_ROLES.includes(role);

    const paginate = { offset, limit };

    // PUBLIC
    if (config.strategy === STRATEGY.PUBLIC) {
      return sequelize.models[config.model].findAll({ ...paginate, raw: true });
    }

    // FULL FOR ROLES
    if (config.strategy === STRATEGY.FULL_FOR_ROLES) {
      if (!config.allowedRoles.includes(role)) return [];
      return sequelize.models[config.model].findAll({ ...paginate, raw: true });
    }

    // OWNED — special cases
    const m = (name) => sequelize.models[name];

    if (tableKey === "User") {
      const rows = await m("User").findAll({
        ...paginate,
        attributes: { exclude: ["password"] },
        raw: true,
      });
      return rows;
    }

    if (tableKey === "DisciplineCase") {
      const fullRoles = [...ADMIN_ROLES, ROLES.DISCIPLINE, ROLES.PSYCHOSOCIAL];
      const where = fullRoles.includes(role)
        ? {}
        : { [Op.or]: [{ recordedBy: userId }, { teacherId: userId }] };
      return m("DisciplineCase").findAll({ where, ...paginate, raw: true });
    }

    if (tableKey === "Specialty") {
      if (isFullAdmin)
        return m("Specialty").findAll({ ...paginate, raw: true });
      if (!classIds.length) return [];
      return m("Specialty").findAll({
        include: [
          {
            model: m("SpecialtyClass"),
            where: { classId: { [Op.in]: classIds } },
            required: true,
          },
        ],
        ...paginate,
        distinct: true,
        raw: true,
      });
    }

    if (tableKey === "Group") {
      return m("Group").findAll({
        include: [
          { model: m("GroupParticipant"), where: { userId }, required: true },
        ],
        ...paginate,
        distinct: true,
        raw: true,
      });
    }

    if (tableKey === "GroupParticipant") {
      const userGroups = await m("GroupParticipant").findAll({
        attributes: ["groupId"],
        where: { userId },
      });
      const groupIds = userGroups.map((r) => r.groupId);
      if (!groupIds.length) return [];
      return m("GroupParticipant").findAll({
        where: { groupId: { [Op.in]: groupIds } },
        ...paginate,
        raw: true,
      });
    }

    if (tableKey === "Message") {
      const userGroups = await m("GroupParticipant").findAll({
        attributes: ["groupId"],
        where: { userId },
      });
      const groupIds = userGroups.map((r) => r.groupId);
      return m("Message").findAll({
        where: {
          [Op.or]: [
            { senderId: userId },
            { receiverId: userId },
            ...(groupIds.length ? [{ groupId: { [Op.in]: groupIds } }] : []),
          ],
        },
        ...paginate,
        raw: true,
      });
    }

    if (tableKey === "AttendanceRecord") {
      if (isFullAdmin)
        return m("AttendanceRecord").findAll({ ...paginate, raw: true });
      if (!classIds.length) return [];
      return m("AttendanceRecord").findAll({
        include: [
          {
            model: m("AttendanceSession"),
            where: { classId: { [Op.in]: classIds } },
            required: true,
          },
        ],
        ...paginate,
        raw: true,
      });
    }

    if (tableKey === "Fee") {
      if (isAdminRole) return m("Fee").findAll({ ...paginate, raw: true });
      if (!classIds.length) return [];
      return m("Fee").findAll({
        include: [
          {
            model: m("Student"),
            where: { classId: { [Op.in]: classIds } },
            required: true,
          },
        ],
        ...paginate,
        raw: true,
      });
    }

    // Generic filterType
    const model = m(config.model);
    const filterKey = config.filterKey || "classId";

    switch (config.filterType) {
      case FILTER_TYPE.BY_CLASS_IDS:
        if (isFullAdmin) return model.findAll({ ...paginate, raw: true });
        if (!classIds.length) return [];
        return model.findAll({
          where: { [filterKey]: { [Op.in]: classIds } },
          ...paginate,
          raw: true,
        });

      case FILTER_TYPE.BY_SUBJECT_IDS:
        if (isFullAdmin) return model.findAll({ ...paginate, raw: true });
        if (!subjectIds.length) return [];
        return model.findAll({
          where: { id: { [Op.in]: subjectIds } },
          ...paginate,
          raw: true,
        });

      case FILTER_TYPE.BY_CLASS_AND_SUBJECT:
        if (isFullAdmin) return model.findAll({ ...paginate, raw: true });
        if (!classIds.length || !subjectIds.length) return [];
        return model.findAll({
          where: {
            classId: { [Op.in]: classIds },
            subjectId: { [Op.in]: subjectIds },
          },
          ...paginate,
          raw: true,
        });

      case FILTER_TYPE.BY_USER_ID:
        if (isAdminRole) return model.findAll({ ...paginate, raw: true });
        return model.findAll({
          where: { [config.filterKey || "userId"]: userId },
          ...paginate,
          raw: true,
        });

      case FILTER_TYPE.BY_USER_ID_ONLY:
        return model.findAll({
          where: { [config.filterKey || "userId"]: userId },
          ...paginate,
          raw: true,
        });

      default:
        return [];
    }
  }
}

module.exports = ScopeResolver;
