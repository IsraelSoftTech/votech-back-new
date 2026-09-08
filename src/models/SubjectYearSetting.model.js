"use strict";
const { Model, DataTypes } = require("sequelize");

// Year-scoped coefficient/category for a subject. subjects.coefficient and
// subjects.category still exist as denormalized "current value" fields
// (kept in sync whenever the active year's settings change, and still what
// the subject list/edit form reads), but this table is authoritative for
// anything computing a mark in a SPECIFIC year. Report cards, master
// sheets, the marks matrix and transcripts read this, never the live
// fields, so raising a coefficient today cannot retroactively change last
// year's averages, ranks or remarks.
module.exports = (sequelize) => {
  class SubjectYearSetting extends Model {
    static associate(models) {
      SubjectYearSetting.belongsTo(models.Subject, {
        foreignKey: "subject_id",
        as: "subject",
      });
      SubjectYearSetting.belongsTo(models.AcademicYear, {
        foreignKey: "academic_year_id",
        as: "academic_year",
      });
    }
  }

  SubjectYearSetting.init(
    {
      academic_year_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },
      subject_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },
      coefficient: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 1,
        validate: {
          isInt: { msg: "Coefficient must be an integer" },
          min: { args: [1], msg: "Coefficient must be at least 1" },
          max: { args: [20], msg: "Coefficient cannot be greater than 20" },
        },
      },
      category: {
        type: DataTypes.STRING(20),
        allowNull: false,
        defaultValue: "general",
        validate: {
          isIn: {
            args: [["general", "professional", "practical"]],
            msg: "Category must be either 'general', 'practical' or 'professional'",
          },
        },
      },
    },
    {
      sequelize,
      modelName: "SubjectYearSetting",
      tableName: "subject_year_settings",
      timestamps: true,
      createdAt: "created_at",
      updatedAt: "updated_at",
      indexes: [
        {
          unique: true,
          fields: ["academic_year_id", "subject_id"],
          name: "unique_subject_year_setting",
        },
      ],
    }
  );

  return SubjectYearSetting;
};
