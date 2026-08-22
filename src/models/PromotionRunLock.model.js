"use strict";
const { Model, DataTypes } = require("sequelize");

// Single-row mutex enforcing "only one promotion run may be active
// system-wide at any time". Acquired/released via atomic UPDATE ... WHERE
// statements (see promotion.controller.js) so there is no check-then-act
// race between two admins starting a run at the same moment.
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
