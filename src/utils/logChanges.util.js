"use strict";
require("dotenv").config();
const { StatusCodes } = require("http-status-codes");
const models = require("../models/index.model");
const AppError = require("../utils/AppError");

const ChangeLogModel = models.change_logs;

async function initChangeLogs() {
  try {
    const tables = await ChangeLogModel.sequelize
      .getQueryInterface()
      .showAllTables();
    if (!tables.includes(ChangeLogModel.getTableName())) {
      await ChangeLogModel.sync({ force: false });
    }
  } catch (err) {
    throw err;
  }
}

initChangeLogs();

const ChangeTypes = {
  create: "INSERT",
  update: "UPDATE",
  delete: "DELETE",
};

if (!process.env.NODE_ENV) {
  throw new AppError(
    "Node environment, .env config not found",
    StatusCodes.INTERNAL_SERVER_ERROR
  );
}

/**
 * Logs changes in the change_logs table.
 * Deduplicates per record per user per source (latest change wins)
 *
 * @param {string} tableName - Table being changed
 * @param {number|string} recordId - ID of the affected record
 * @param {string} changeType - One of ChangeTypes
 * @param {object} user - User object, must contain id
 * @param {object|null} fieldsChanged - Optional field-level change details
 */
const logChanges = async (
  tableName,
  recordId,
  changeType,
  user,
  fieldsChanged = null
) => {
  if (!user || !user.id) {
    console.warn("Cannot log change: invalid user object");
    return;
  }

  const changedAt = new Date();
  const source = process.env.NODE_ENV === "desktop" ? "local" : "online";
  const synced = false;

  try {
    const existing = await ChangeLogModel.findOne({
      where: {
        table_name: tableName,
        record_id: recordId,
        changed_by: user.id,
        source,
      },
    });

    if (existing) {
      // Update existing log entry (latest change wins)
      await existing.update({
        change_type: changeType,
        changed_at: changedAt,
        fields_changed: fieldsChanged,
      });
    } else {
      await ChangeLogModel.create({
        table_name: tableName,
        record_id: recordId,
        change_type: changeType,
        changed_at: changedAt,
        changed_by: user.id,
        fields_changed: fieldsChanged,
        source,
        synced,
      });
    }
  } catch (err) {
    console.error("Failed to log change:", err);
  }
};

module.exports = { logChanges, ChangeTypes };
