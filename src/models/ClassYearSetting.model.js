"use strict";
const { Model, DataTypes } = require("sequelize");

// Year-scoped name/department for a class. classes.name and
// classes.department_id still exist as denormalized "current value" fields
// (kept in sync whenever the active year's settings change, and still what
// every dropdown and the class list read), but this table is what a
// document generated FOR a specific year reads, so renaming a class or
// moving it into another department cannot rewrite the header of every
// report card that class ever produced.
//
// classes.id is deliberately untouched — it is the permanent identity that
// marks, promotions, class-subject and class-master rows all reference.
module.exports = (sequelize) => {
  class ClassYearSetting extends Model {
    static associate(models) {
      ClassYearSetting.belongsTo(models.Class, {
        foreignKey: "class_id",
        as: "class",
      });
      ClassYearSetting.belongsTo(models.Specialty, {
        foreignKey: "department_id",
        as: "department",
      });
      ClassYearSetting.belongsTo(models.AcademicYear, {
        foreignKey: "academic_year_id",
        as: "academic_year",
      });
    }
  }

  ClassYearSetting.init(
    {
      academic_year_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },
      class_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },
      name: {
        type: DataTypes.STRING(100),
        allowNull: false,
      },
      department_id: {
        type: DataTypes.INTEGER,
        allowNull: true,
      },
    },
    {
      sequelize,
      modelName: "ClassYearSetting",
      tableName: "class_year_settings",
      timestamps: true,
      createdAt: "created_at",
      updatedAt: "updated_at",
      indexes: [
        {
          unique: true,
          fields: ["academic_year_id", "class_id"],
          name: "unique_class_year_setting",
        },
      ],
    }
  );

  return ClassYearSetting;
};
