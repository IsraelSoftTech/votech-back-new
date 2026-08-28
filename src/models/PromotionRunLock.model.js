"use strict";
const { Model, DataTypes } = require("sequelize");

// Single-row mutex, extended to cover two operations that must never
// overlap with each other: a promotion run, and an academic year switch.
// Both are acquired/released via atomic UPDATE ... WHERE statements (see
// promotion.controller.js and accademicYear.controller.js) so there is no
// check-then-act race between two admins acting at the same moment, and
// neither operation can start while the other is mid-flight.
module.exports = (sequelize, DataTypes) => {
  class PromotionRunLock extends Model {
    static associate(models) {
      PromotionRunLock.belongsTo(models.PromotionRun, {
        foreignKey: "current_run_id",
        as: "current_run",
      });
    }
  }

  PromotionRunLock.init(
    {
      id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        defaultValue: 1,
      },
      current_run_id: {
        type: DataTypes.INTEGER,
        allowNull: true,
        references: { model: "promotion_runs", key: "id" },
      },
      year_switch_in_progress: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      },
      locked_at: {
        type: DataTypes.DATE,
        allowNull: true,
      },
    },
    {
      sequelize,
      modelName: "PromotionRunLock",
      tableName: "promotion_run_lock",
      timestamps: false,
    }
  );

  return PromotionRunLock;
};
