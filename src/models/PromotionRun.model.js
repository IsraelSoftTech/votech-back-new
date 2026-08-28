"use strict";
const { Model, DataTypes } = require("sequelize");

module.exports = (sequelize, DataTypes) => {
  class PromotionRun extends Model {
    static associate(models) {
      PromotionRun.belongsTo(models.AcademicYear, {
        foreignKey: "academic_year_from_id",
        as: "academic_year_from",
      });
      PromotionRun.belongsTo(models.AcademicYear, {
        foreignKey: "academic_year_to_id",
        as: "academic_year_to",
      });
      PromotionRun.belongsTo(models.User, {
        foreignKey: "initiated_by",
        as: "initiator",
      });
      PromotionRun.hasMany(models.PromotionRunMove, {
        foreignKey: "run_id",
        as: "moves",
      });
    }
  }

  PromotionRun.init(
    {
      scope: {
        type: DataTypes.ENUM("class", "department", "school", "manual"),
        allowNull: false,
      },
      academic_year_from_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: { model: "academicYears", key: "id" },
      },
      academic_year_to_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: { model: "academicYears", key: "id" },
      },
      // Coarse run-level status, derived from its moves but kept denormalized
      // for cheap polling/history-list reads without joining every move.
      status: {
        type: DataTypes.ENUM(
          "pending",
          "running",
          "completed",
          "interrupted",
          "failed"
        ),
        allowNull: false,
        defaultValue: "pending",
      },
      initiated_by: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: { model: "users", key: "id" },
      },
      initiated_at: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW,
      },
      completed_at: {
        type: DataTypes.DATE,
        allowNull: true,
      },
      // Bumped every time the watchdog finds this run stalled (stale
      // updated_at while status='running') and auto-resumes it. Surfaced
      // in the history UI so an admin always sees when self-healing kicked
      // in, even though it happened without their intervention.
      interruption_count: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 0,
      },
    },
    {
      sequelize,
      modelName: "PromotionRun",
      tableName: "promotion_runs",
      timestamps: true,
      createdAt: "created_at",
      updatedAt: "updated_at",
    }
  );

  return PromotionRun;
};
