"use strict";

const bcrypt = require("bcryptjs");
const { StatusCodes } = require("http-status-codes");
const { sequelize } = require("../db");
const AppError = require("./AppError");

// Deliberately independent of req.user. Sensitive actions (switching the
// academic year, granting/revoking archived-year access) re-verify the
// password and role directly against the database at the moment of the
// action, not against whatever protect() attached to the request earlier.
// This means the shape of req.user can change later (e.g. the password
// hash being dropped from it for security reasons) without breaking
// anything here.
async function verifyPasswordAndRole(userId, password, expectedRoles) {
  if (!password) {
    throw new AppError("Password is required", StatusCodes.BAD_REQUEST);
  }

  const [row] = await sequelize.query(
    "SELECT id, password, role FROM public.users WHERE id = :id LIMIT 1",
    { replacements: { id: userId }, type: sequelize.QueryTypes.SELECT }
  );

  if (!row) {
    throw new AppError("User not found", StatusCodes.UNAUTHORIZED);
  }

  const roles = Array.isArray(expectedRoles) ? expectedRoles : [expectedRoles];
  if (!roles.includes(row.role)) {
    throw new AppError(
      "You no longer have the role required for this action",
      StatusCodes.FORBIDDEN
    );
  }

  const valid = await bcrypt.compare(password, row.password);
  if (!valid) {
    throw new AppError("Incorrect password", StatusCodes.UNAUTHORIZED);
  }

  return { id: row.id, role: row.role };
}

module.exports = { verifyPasswordAndRole };
