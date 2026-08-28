"use strict";
const { Model, DataTypes } = require("sequelize");

// One "print run" an admin starts, covering one or more classes. Mirrors
// PromotionRun/PromotionRunMove: a session is the umbrella, a
// ReportCardRun is one class within it, so a whole-school session costs no
// more peak memory than a single-class one, classes are always processed
// strictly one at a time (see reportCardRunLock).
module.exports = (sequelize, DataTypes) => {
  class ReportCardSession extends Model {
    static associate(models) {
      ReportCardSession.belongsTo(models.AcademicYear, {
        foreignKey: "academic_year_id",
        as: "academic_year",
      });
      ReportCardSession.belongsTo(models.User, {
        foreignKey: "initiated_by",
        as: "initiator",
      });
      ReportCardSession.hasMany(models.ReportCardRun, {
        foreignKey: "session_id",
        as: "runs",
      });
    }
  }

  ReportCardSession.init(
    {
      academic_year_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: { model: "academicYears", key: "id" },
      },
      term: {
        type: DataTypes.STRING(10),
        allowNull: false,
        defaultValue: "term3",
        validate: {
          isIn: {
            args: [["term1", "term2", "term3", "annual"]],
            msg: "term must be term1, term2, term3, or annual",
          },
        },
      },
      status: {
        type: DataTypes.STRING(20),
        allowNull: false,
        defaultValue: "pending",
        validate: {
          isIn: {
            args: [["pending", "running", "completed", "interrupted", "failed"]],
            msg: "invalid session status",
          },
        },
      },
      initiated_by: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: { model: "users", key: "id" },
      },
      total_classes: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
      completed_classes: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
      failed_classes: { type: DataTypes.INTEGER, allowNull: false, defaultValue: 0 },
      started_at: { type: DataTypes.DATE, allowNull: true },
      completed_at: { type: DataTypes.DATE, allowNull: true },
    },
    {
      sequelize,
      modelName: "ReportCardSession",
      tableName: "report_card_sessions",
      timestamps: true,
      createdAt: "created_at",
      updatedAt: "updated_at",
    }
  );

  return ReportCardSession;
};
