"use strict";
const { Model, DataTypes } = require("sequelize");

module.exports = (sequelize, DataTypes) => {
  class StudentPromotion extends Model {
    static associate(models) {
      StudentPromotion.belongsTo(models.PromotionRun, {
        foreignKey: "run_id",
        as: "run",
        onDelete: "CASCADE",
      });
      StudentPromotion.belongsTo(models.PromotionRunMove, {
        foreignKey: "run_move_id",
        as: "move",
        onDelete: "CASCADE",
      });
      StudentPromotion.belongsTo(models.Student, {
        foreignKey: "student_id",
        as: "student",
      });
      StudentPromotion.belongsTo(models.Class, {
        foreignKey: "from_class_id",
        as: "from_class",
      });
      StudentPromotion.belongsTo(models.Class, {
        foreignKey: "to_class_id",
        as: "to_class",
      });
      StudentPromotion.belongsTo(models.AcademicYear, {
        foreignKey: "from_academic_year_id",
        as: "from_academic_year",
      });
      StudentPromotion.belongsTo(models.AcademicYear, {
        foreignKey: "to_academic_year_id",
        as: "to_academic_year",
      });
    }
  }

  StudentPromotion.init(
    {
      run_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: { model: "promotion_runs", key: "id" },
      },
      run_move_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: { model: "promotion_run_moves", key: "id" },
      },
      student_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: { model: "students", key: "id" },
      },
      from_class_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: { model: "classes", key: "id" },
      },
      from_academic_year_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: { model: "academicYears", key: "id" },
      },
      // Null when the student graduated instead of moving to another class.
      to_class_id: {
        type: DataTypes.INTEGER,
        allowNull: true,
        references: { model: "classes", key: "id" },
      },
      to_academic_year_id: {
        type: DataTypes.INTEGER,
        allowNull: true,
        references: { model: "academicYears", key: "id" },
      },
      decision: {
        type: DataTypes.ENUM("promoted", "promoted_on_condition", "failed"),
        allowNull: false,
      },
      overall_average: {
        type: DataTypes.DOUBLE,
        allowNull: true,
      },
      has_incomplete_data: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      },
      // Which compulsory subjects passed/failed, professional-pass count,
      // exact missing-mark gaps if has_incomplete_data, the full working
      // behind the decision, kept forever for audit purposes.
      detail_snapshot: {
        type: DataTypes.JSONB,
        allowNull: false,
      },
    },
    {
      sequelize,
      modelName: "StudentPromotion",
      tableName: "student_promotions",
      timestamps: true,
      createdAt: "created_at",
      updatedAt: false,
      indexes: [
        { fields: ["student_id"] },
        { fields: ["run_move_id"] },
        { fields: ["from_class_id", "from_academic_year_id"] },
      ],
    }
  );

  return StudentPromotion;
};
