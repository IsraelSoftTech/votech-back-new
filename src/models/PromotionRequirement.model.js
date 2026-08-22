"use strict";
const { Model, DataTypes } = require("sequelize");

module.exports = (sequelize, DataTypes) => {
  class PromotionRequirement extends Model {
    static associate(models) {
      PromotionRequirement.belongsTo(models.AcademicYear, {
        foreignKey: "academic_year_id",
        as: "academic_year",
        onDelete: "CASCADE",
      });
      PromotionRequirement.belongsTo(models.Class, {
        foreignKey: "class_id",
        as: "class",
        onDelete: "CASCADE",
      });
    }
  }

  PromotionRequirement.init(
    {
      academic_year_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: { model: "academicYears", key: "id" },
      },
      class_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: { model: "classes", key: "id" },
      },
      min_average: {
        type: DataTypes.DOUBLE,
        allowNull: false,
        validate: {
          min: { args: [0], msg: "Minimum promotion average cannot be negative" },
          max: { args: [20], msg: "Minimum promotion average cannot exceed 20" },
        },
      },
      pass_mark: {
        type: DataTypes.DOUBLE,
        allowNull: false,
        defaultValue: 10,
        validate: {
          min: { args: [0], msg: "Pass mark cannot be negative" },
          max: { args: [20], msg: "Pass mark cannot exceed 20" },
        },
      },
      compulsory_general_subject_ids: {
        type: DataTypes.ARRAY(DataTypes.INTEGER),
        allowNull: false,
        defaultValue: [],
      },
      compulsory_professional_subject_ids: {
        type: DataTypes.ARRAY(DataTypes.INTEGER),
        allowNull: false,
        defaultValue: [],
      },
      min_professional_subjects_passed: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 0,
        validate: {
          isInt: { msg: "Minimum professional subjects passed must be an integer" },
          min: { args: [0], msg: "Minimum professional subjects passed cannot be negative" },
        },
      },
    },
    {
      sequelize,
      modelName: "PromotionRequirement",
      tableName: "promotion_requirements",
      timestamps: true,
      createdAt: "created_at",
      updatedAt: "updated_at",
      indexes: [
        {
          unique: true,
          fields: ["academic_year_id", "class_id"],
        },
      ],
    }
  );

  return PromotionRequirement;
};
