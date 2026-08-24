"use strict";

const { StatusCodes } = require("http-status-codes");
const { Op } = require("sequelize");
const AppError = require("./AppError");
const { getRequestContext } = require("./requestContext.util");

// ─── Core checks ─────────────────────────────────────────────────────

async function getActiveYear() {
  const models = require("../models/index.model");
  return models.AcademicYear.findOne({ where: { status: "active" } });
}

async function hasLiveGrant(academicYearId, userId, role) {
  if (!userId || role !== "Admin3") return false;
  const models = require("../models/index.model");
  const grants = await models.AcademicYearGrant.findAll({
    where: {
      academic_year_id: academicYearId,
      revoked_at: null,
      expires_at: { [Op.gt]: new Date() },
    },
  });
  return grants.some((g) => g.isLiveFor(userId, role));
}

/**
 * Throws if the given academic year is archived and the current request
 * context (from AsyncLocalStorage) has no live grant for it. No-op if the
 * year is active, or if there's no request context at all (a script/
 * console context — those are trusted by default, same as any other
 * internal tool).
 */
async function assertYearWritable(academicYearId) {
  if (!academicYearId) return;

  const models = require("../models/index.model");
  const year = await models.AcademicYear.findByPk(academicYearId);
  if (!year || year.status === "active") return;

  const ctx = getRequestContext();
  if (!ctx) return; // no request context — trusted internal caller

  const granted = await hasLiveGrant(academicYearId, ctx.userId, ctx.role);
  if (granted) return;

  throw new AppError(
    `The academic year "${year.name}" is archived and read-only. ` +
      `An Admin1 must grant access before it can be edited.`,
    StatusCodes.FORBIDDEN
  );
}

// ─── Hook attachment ─────────────────────────────────────────────────

/**
 * Attaches create/update/destroy (single + bulk) hooks to a model that
 * has an academic_year_id column, enforcing:
 *   - create: the year is always forced to the currently active one,
 *     silently, regardless of what the caller passed in. New data never
 *     lands in an archived year, not even under a grant, grants are for
 *     correcting existing records, not creating new ones in a closed year.
 *   - update/destroy: checked against the record's own existing year
 *     (its value before this write), not anything the caller claims.
 *     Archived + no grant => rejected outright, the record is never
 *     silently moved to a different year.
 *
 * Any call can opt out entirely by passing `{ skipYearLockCheck: true }`
 * in its Sequelize options — used by trusted internal code (the
 * promotion engine, in particular) whose writes are already authorized
 * upfront and shouldn't pay a per-row check on top of that.
 */
function attachYearLockHooks(Model, { yearField = "academic_year_id" } = {}) {
  Model.addHook("beforeCreate", async (instance, options) => {
    if (options.skipYearLockCheck) return;
    if (!(yearField in Model.rawAttributes)) return;

    const activeYear = await getActiveYear();
    if (activeYear) {
      instance.set(yearField, activeYear.id);
    }
  });

  Model.addHook("beforeUpdate", async (instance, options) => {
    if (options.skipYearLockCheck) return;
    if (!(yearField in Model.rawAttributes)) return;

    const priorYearId =
      instance.previous(yearField) ?? instance[yearField] ?? null;
    await assertYearWritable(priorYearId);
  });

  Model.addHook("beforeDestroy", async (instance, options) => {
    if (options.skipYearLockCheck) return;
    if (!(yearField in Model.rawAttributes)) return;

    await assertYearWritable(instance[yearField]);
  });

  Model.addHook("beforeBulkUpdate", async (options) => {
    if (options.skipYearLockCheck) return;
    if (!(yearField in Model.rawAttributes)) return;
    await assertBulkWritable(Model, yearField, options.where);
  });

  Model.addHook("beforeBulkDestroy", async (options) => {
    if (options.skipYearLockCheck) return;
    if (!(yearField in Model.rawAttributes)) return;
    await assertBulkWritable(Model, yearField, options.where);
  });
}

// A bulk operation's WHERE clause may not mention academic_year_id at
// all, so look up which years the actually-targeted rows belong to and
// check every one. All-or-nothing: if any targeted row is locked, the
// whole operation is rejected, never partially applied.
async function assertBulkWritable(Model, yearField, where) {
  const rows = await Model.findAll({
    where,
    attributes: [yearField],
    group: [yearField],
    raw: true,
  });
  for (const row of rows) {
    await assertYearWritable(row[yearField]);
  }
}

module.exports = {
  assertYearWritable,
  hasLiveGrant,
  getActiveYear,
  attachYearLockHooks,
};
