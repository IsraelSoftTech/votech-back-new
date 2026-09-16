"use strict";

const { Op } = require("sequelize");
const { StatusCodes } = require("http-status-codes");
const models = require("../models/index.model");
const AppError = require("../utils/AppError");
const catchAsync = require("../utils/catchAsync");
const appResponder = require("../utils/appResponder");
const { verifyPasswordAndRole } = require("../utils/freshAuth.util");
const { recordAcademicYearSwitchLog } = require("../utils/academicYearSwitchAudit.util");
const { getIpAddress } = require("../../routes/utils");

// One readable line per grant event for the academic-year activity log
// (the list Admin1 sees), so "who was let into which year, until when, and
// why" is answerable from the log alone without opening the grants table.
function describeGrantTargets(grant, users = []) {
  if (grant.is_global) return "all Admin3 users";
  const names = users.map((u) => u.name || u.username || `user ${u.id}`);
  return names.length ? names.join(", ") : `Admin3 user(s) ${(grant.admin3_user_ids || []).join(", ")}`;
}

const grantIncludes = [
  { association: models.AcademicYearGrant.associations.academic_year },
  {
    association: models.AcademicYearGrant.associations.grantor,
    attributes: ["id", "name", "username", "email"],
  },
  {
    association: models.AcademicYearGrant.associations.revoker,
    attributes: ["id", "name", "username", "email"],
  },
];

// ─── Create a grant (Admin1 only) ──────────────────────────────────────
//
// Unlocks write access to one archived academic year, for a limited time,
// for either a named list of Admin3 users or all Admin3 users globally.
// Never changes the active year, that is a wholly separate action
// (accademicYear.controller.js's switchAcademicYear).

const createGrant = catchAsync(async (req, res, next) => {
  const {
    password,
    academic_year_id,
    is_global,
    admin3_user_ids,
    reason,
    expires_at,
  } = req.body || {};

  await verifyPasswordAndRole(req.user.id, password, "Admin1");

  if (!academic_year_id) {
    return next(
      new AppError("academic_year_id is required", StatusCodes.BAD_REQUEST)
    );
  }
  const year = await models.AcademicYear.findByPk(academic_year_id);
  if (!year) {
    return next(new AppError("Academic year not found", StatusCodes.NOT_FOUND));
  }

  if (!expires_at || new Date(expires_at) <= new Date()) {
    return next(
      new AppError(
        "expires_at is required and must be in the future",
        StatusCodes.BAD_REQUEST
      )
    );
  }

  const targetIds = Array.isArray(admin3_user_ids) ? admin3_user_ids : [];
  if (!is_global && targetIds.length === 0) {
    return next(
      new AppError(
        "Either is_global must be true, or at least one Admin3 user must be named",
        StatusCodes.BAD_REQUEST
      )
    );
  }

  if (targetIds.length > 0) {
    const users = await models.User.findAll({
      where: { id: { [Op.in]: targetIds } },
      attributes: ["id", "role"],
    });
    const foundIds = new Set(users.map((u) => u.id));
    const missing = targetIds.filter((id) => !foundIds.has(id));
    if (missing.length) {
      return next(
        new AppError(
          `User id(s) not found: ${missing.join(", ")}`,
          StatusCodes.BAD_REQUEST
        )
      );
    }
    const notAdmin3 = users.filter((u) => u.role !== "Admin3");
    if (notAdmin3.length) {
      return next(
        new AppError(
          `Grants can only be issued to Admin3 users. Not Admin3: ${notAdmin3
            .map((u) => u.id)
            .join(", ")}`,
          StatusCodes.BAD_REQUEST
        )
      );
    }
  }

  const grantedUsers =
    !is_global && targetIds.length
      ? await models.User.findAll({
          where: { id: { [Op.in]: targetIds } },
          attributes: ["id", "name", "username"],
          raw: true,
        })
      : [];

  // Grant row and its log line commit together: a grant that exists but
  // never shows in Admin1's activity log is exactly the gap this closes.
  const grant = await models.AcademicYearGrant.sequelize.transaction(async (t) => {
    const row = await models.AcademicYearGrant.create(
      {
        academic_year_id,
        granted_by: req.user.id,
        is_global: !!is_global,
        admin3_user_ids: is_global ? [] : targetIds,
        reason: reason || null,
        granted_at: new Date(),
        expires_at,
      },
      { transaction: t }
    );
    await recordAcademicYearSwitchLog(
      {
        from_year_id: null,
        to_year_id: academic_year_id,
        action: "grant",
        performed_by: req.user.id,
        performed_at: row.granted_at,
        reason: `Access granted to ${describeGrantTargets(row, grantedUsers)} until ${new Date(
          expires_at
        ).toISOString()}${reason ? `. ${reason}` : ""}`,
        ip_address: getIpAddress(req),
      },
      req.user,
      t
    );
    return row;
  });

  const created = await models.AcademicYearGrant.findByPk(grant.id, {
    include: grantIncludes,
  });
  appResponder(StatusCodes.CREATED, created, res);
});

// ─── History (Admin1 only) ──────────────────────────────────────────────

const listGrants = catchAsync(async (req, res) => {
  const grants = await models.AcademicYearGrant.findAll({
    order: [["id", "DESC"]],
    limit: 200,
    include: grantIncludes,
  });
  appResponder(StatusCodes.OK, grants, res);
});

// ─── Revoke (Admin1 only) ────────────────────────────────────────────────

const revokeGrant = catchAsync(async (req, res, next) => {
  const { password } = req.body || {};
  await verifyPasswordAndRole(req.user.id, password, "Admin1");

  const grant = await models.AcademicYearGrant.findByPk(req.params.id);
  if (!grant) return next(new AppError("Grant not found", StatusCodes.NOT_FOUND));
  if (grant.revoked_at) {
    return next(
      new AppError("This grant was already revoked", StatusCodes.BAD_REQUEST)
    );
  }

  const grantedUsers = grant.is_global
    ? []
    : await models.User.findAll({
        where: { id: { [Op.in]: grant.admin3_user_ids || [] } },
        attributes: ["id", "name", "username"],
        raw: true,
      });

  await models.AcademicYearGrant.sequelize.transaction(async (t) => {
    const revokedAt = new Date();
    await grant.update({ revoked_at: revokedAt, revoked_by: req.user.id }, { transaction: t });
    await recordAcademicYearSwitchLog(
      {
        from_year_id: null,
        to_year_id: grant.academic_year_id,
        action: "grant_revoke",
        performed_by: req.user.id,
        performed_at: revokedAt,
        reason: `Access revoked for ${describeGrantTargets(grant, grantedUsers)} (grant #${grant.id})${
          req.body?.reason ? `. ${req.body.reason}` : ""
        }`,
        ip_address: getIpAddress(req),
      },
      req.user,
      t
    );
  });

  const updated = await models.AcademicYearGrant.findByPk(grant.id, {
    include: grantIncludes,
  });
  appResponder(StatusCodes.OK, updated, res);
});

// ─── My live grants (any authenticated Admin3) ──────────────────────────
//
// Lets the frontend show "you have temporary access to <year> until <time>"
// without needing Admin1-only visibility into the whole grant history.

const listMyLiveGrants = catchAsync(async (req, res) => {
  if (req.user.role !== "Admin3") {
    return appResponder(StatusCodes.OK, [], res);
  }
  const grants = await models.AcademicYearGrant.findAll({
    where: { revoked_at: null, expires_at: { [Op.gt]: new Date() } },
    include: [{ association: models.AcademicYearGrant.associations.academic_year }],
  });
  const live = grants.filter((g) => g.isLiveFor(req.user.id, req.user.role));
  appResponder(StatusCodes.OK, live, res);
});

module.exports = {
  createGrant,
  listGrants,
  revokeGrant,
  listMyLiveGrants,
};
