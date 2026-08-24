"use strict";
const { Model, DataTypes } = require("sequelize");

// Single-row mutex capping report-card generation to one active session at
// a time. Unlike PromotionRunLock, this isn't about data correctness
// (generation never mutates student data), it's purely to protect the
// shared VPS memory budget from two large jobs running at once.
module.exports = (sequelize, DataTypes) => {
  class ReportCardRunLock extends Model {
    static associate(models) {
      ReportCardRunLock.belongsTo(models.ReportCardSession, {
        foreignKey: "current_session_id",
        as: "current_session",
      });
    }
  }

  ReportCardRunLock.init(
    {
      id: { type: DataTypes.INTEGER, primaryKey: true, defaultValue: 1 },
      current_session_id: {
        type: DataTypes.INTEGER,
        allowNull: true,
        references: { model: "report_card_sessions", key: "id" },
      },
      locked_at: { type: DataTypes.DATE, allowNull: true },
    },
    {
      sequelize,
      modelName: "ReportCardRunLock",
      tableName: "report_card_run_lock",
      timestamps: false,
    }
  );

  return ReportCardRunLock;
};
