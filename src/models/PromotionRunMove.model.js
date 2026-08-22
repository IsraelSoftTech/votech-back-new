"use strict";
const { Model, DataTypes } = require("sequelize");

module.exports = (sequelize, DataTypes) => {
  class PromotionRunMove extends Model {
    static associate(models) {
      PromotionRunMove.belongsTo(models.PromotionRun, {
        foreignKey: "run_id",
        as: "run",
        onDelete: "CASCADE",
      });
      PromotionRunMove.belongsTo(models.Class, {
        foreignKey: "source_class_id",
        as: "source_class",
      });
      PromotionRunMove.belongsTo(models.Class, {
        foreignKey: "destination_class_id",
        as: "destination_class",
      });
      PromotionRunMove.belongsTo(models.User, {
        foreignKey: "reversed_by",
        as: "reverser",
      });
      PromotionRunMove.hasMany(models.StudentPromotion, {
        foreignKey: "run_move_id",
        as: "student_promotions",
      });
    }
  }

  PromotionRunMove.init(
    {
      run_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: { model: "promotion_runs", key: "id" },
      },
      source_class_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: { model: "classes", key: "id" },
      },
      // Null for a graduation move, those students exit the school
      // instead of landing in another class.
      destination_class_id: {
        type: DataTypes.INTEGER,
        allowNull: true,
        references: { model: "classes", key: "id" },
      },
      is_graduation: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      },
      // Copy of the PromotionRequirement row (or the manual override values)
      // used to compute decisions for this move, frozen at execution time.
      requirement_snapshot: {
        type: DataTypes.JSONB,
        allowNull: false,
      },
      status: {
        type: DataTypes.ENUM(
          "pending",
          "running",
          "completed",
          "interrupted",
          "reversed"
        ),
        allowNull: false,
        defaultValue: "pending",
      },
      total_students: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 0,
      },
      processed_students: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 0,
      },
      // Highest source-class student id processed so far, in id-ascending
      // order, the safe, unambiguous resume point after an interruption.
      cursor_student_id: {
        type: DataTypes.INTEGER,
        allowNull: true,
      },
      started_at: { type: DataTypes.DATE, allowNull: true },
      completed_at: { type: DataTypes.DATE, allowNull: true },
      reversed_by: {
        type: DataTypes.INTEGER,
        allowNull: true,
        references: { model: "users", key: "id" },
      },
      reversed_at: { type: DataTypes.DATE, allowNull: true },
    },
    {
      sequelize,
      modelName: "PromotionRunMove",
      tableName: "promotion_run_moves",
      timestamps: true,
      createdAt: "created_at",
      updatedAt: "updated_at",
    }
  );

  return PromotionRunMove;
};
