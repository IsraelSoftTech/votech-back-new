"use strict";

const { Model, DataTypes } = require("sequelize");

// "grant" / "grant_revoke": Admin1 unlocking (or re-locking) an archived
// year for Admin3s. They live in the same log as switches so Admin1 sees
// one chronological story per year, not two lists to cross-reference.
// Keep in sync with the CHECK constraint in
// src/db/migrations/academicYearManagement.step1.js.
const VALID_ACTIONS = ["switch", "reactivate", "archive", "grant", "grant_revoke"];

function defineAcademicYearSwitchLog(sequelize) {
  class AcademicYearSwitchLog extends Model {
    static associate(models) {
      AcademicYearSwitchLog.belongsTo(models.AcademicYear, {
        foreignKey: "from_year_id",
        as: "fromYear",
      });
      AcademicYearSwitchLog.belongsTo(models.AcademicYear, {
        foreignKey: "to_year_id",
        as: "toYear",
      });
      AcademicYearSwitchLog.belongsTo(models.User, {
        foreignKey: "performed_by",
        as: "performedByUser",
      });
    }
  }

  AcademicYearSwitchLog.init(
    {
      id: {
        type: DataTypes.INTEGER,
        autoIncrement: true,
        primaryKey: true,
      },
      from_year_id: {
        type: DataTypes.INTEGER,
        allowNull: true,
      },
      to_year_id: {
        type: DataTypes.INTEGER,
        allowNull: true,
      },
      action: {
        type: DataTypes.STRING(20),
        allowNull: false,
        validate: {
          isIn: [VALID_ACTIONS],
        },
      },
      performed_by: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },
      performed_at: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW,
      },
      reason: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      ip_address: {
        type: DataTypes.STRING(45),
        allowNull: true,
      },
    },
    {
      sequelize,
      modelName: "AcademicYearSwitchLog",
      tableName: "academic_year_switch_logs",
      timestamps: false,
      indexes: [
        { fields: ["performed_at"] },
        { fields: ["from_year_id"] },
        { fields: ["to_year_id"] },
      ],
    }
  );

  return AcademicYearSwitchLog;
}

defineAcademicYearSwitchLog.VALID_ACTIONS = VALID_ACTIONS;
module.exports = defineAcademicYearSwitchLog;
