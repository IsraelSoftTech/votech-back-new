"use strict";
const { Model, DataTypes } = require("sequelize");

// A time-boxed, Admin1-issued permission to edit an archived academic year.
// Does NOT change which year is globally active — it only unlocks writes,
// for whoever it targets, for as long as it's valid. Rows are never
// deleted, so this table doubles as Admin1's grant history.
module.exports = (sequelize, DataTypes) => {
  class AcademicYearGrant extends Model {
    static associate(models) {
      AcademicYearGrant.belongsTo(models.AcademicYear, {
        foreignKey: "academic_year_id",
        as: "academic_year",
      });
      AcademicYearGrant.belongsTo(models.User, {
        foreignKey: "granted_by",
        as: "grantor",
      });
      AcademicYearGrant.belongsTo(models.User, {
        foreignKey: "revoked_by",
        as: "revoker",
      });
    }

    isLiveFor(userId, role) {
      if (role !== "Admin3") return false;
      if (this.revoked_at) return false;
      if (new Date(this.expires_at) <= new Date()) return false;
      if (this.is_global) return true;
      return Array.isArray(this.admin3_user_ids) && this.admin3_user_ids.includes(userId);
    }
  }

  AcademicYearGrant.init(
    {
      academic_year_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: { model: "academicYears", key: "id" },
      },
      granted_by: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: { model: "users", key: "id" },
      },
      is_global: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      },
      // Specific Admin3 user ids this grant covers. Null/empty when
      // is_global is true.
      admin3_user_ids: {
        type: DataTypes.ARRAY(DataTypes.INTEGER),
        allowNull: false,
        defaultValue: [],
      },
      reason: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      granted_at: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW,
      },
      expires_at: {
        type: DataTypes.DATE,
        allowNull: false,
      },
      revoked_at: {
        type: DataTypes.DATE,
        allowNull: true,
      },
      revoked_by: {
        type: DataTypes.INTEGER,
        allowNull: true,
        references: { model: "users", key: "id" },
      },
    },
    {
      sequelize,
      modelName: "AcademicYearGrant",
      tableName: "academic_year_grants",
      timestamps: true,
      createdAt: "created_at",
      updatedAt: "updated_at",
      indexes: [{ fields: ["academic_year_id"] }, { fields: ["granted_by"] }],
    }
  );

  return AcademicYearGrant;
};
