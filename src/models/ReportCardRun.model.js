"use strict";
const { Model, DataTypes } = require("sequelize");

// One class's worth of report-card generation within a session. Each run
// is chunked internally (see reportCardSession.controller.js), so its
// own memory footprint never exceeds one chunk of students regardless of
// class size, and one run failing never touches the others in the session.
module.exports = (sequelize, DataTypes) => {
  class ReportCardRun extends Model {
    static associate(models) {
      ReportCardRun.belongsTo(models.ReportCardSession, {
        foreignKey: "session_id",
        as: "session",
        onDelete: "CASCADE",
      });
      ReportCardRun.belongsTo(models.Class, {
        foreignKey: "class_id",
        as: "class",
      });
    }
  }

  ReportCardRun.init(
    {
      session_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: { model: "report_card_sessions", key: "id" },
      },
      class_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: { model: "classes", key: "id" },
      },
      status: {
        type: DataTypes.STRING(20),
        allowNull: false,
        defaultValue: "pending",
        validate: {
          isIn: {
            args: [["pending", "running", "completed", "failed"]],
            msg: "invalid run status",
          },
        },
      },
      total_students: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
      processed_students: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
      file_url: { type: DataTypes.STRING(500), allowNull: true },
      error_message: { type: DataTypes.TEXT, allowNull: true },
      started_at: { type: DataTypes.DATE, allowNull: true },
      completed_at: { type: DataTypes.DATE, allowNull: true },
    },
    {
      sequelize,
      modelName: "ReportCardRun",
      tableName: "report_card_runs",
      timestamps: true,
      createdAt: "created_at",
      updatedAt: "updated_at",
    }
  );

  return ReportCardRun;
};
