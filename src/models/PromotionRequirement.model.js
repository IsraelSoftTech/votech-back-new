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
      // "split" waives the same-department destination check and requires
      // an explicit destination class per promoted student (e.g. Orientation
      // classes fanning out into Electrical/Building/Mechanics/...), instead
      // of one destination class for the whole move.
      promotion_mode: {
        type: DataTypes.STRING(20),
        allowNull: false,
        defaultValue: "single",
        validate: {
          isIn: { args: [["single", "split"]], msg: "promotion_mode must be 'single' or 'split'" },
        },
      },
      // "manual" means this class's real result lives outside the system
      // (a national exam board like GCE/ITVEE), so the criteria above are
      // advisory only, an admin must pick each student's decision by hand
      // instead of it being computed.
      decision_mode: {
        type: DataTypes.STRING(20),
        allowNull: false,
        defaultValue: "automatic",
        validate: {
          isIn: { args: [["automatic", "manual"]], msg: "decision_mode must be 'automatic' or 'manual'" },
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
