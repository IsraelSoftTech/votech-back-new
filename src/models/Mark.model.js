// models/Marks.model.js
"use strict";

const { DataTypes } = require("sequelize");
const { sequelize } = require("../db");
const AppError = require("../utils/AppError");
const { StatusCodes } = require("http-status-codes");

module.exports = (sequelizeInstance = sequelize) => {
  const Marks = sequelizeInstance.define(
    "marks",
    {
      id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },
      student_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: { model: "students", key: "id" },
      },
      subject_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: { model: "subjects", key: "id" },
      },
      class_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: { model: "Class", key: "id" },
      },
      academic_year_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: {
          model: "AcademicYear",
          key: "id",
        },
      },
      term_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: { model: "Term", key: "id" },
      },
      sequence_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: { model: "sequences", key: "id" },
      },
      score: {
        type: DataTypes.DECIMAL(5, 2),
        allowNull: false,
        validate: {
          min: 0,
          max: 20,
          isDecimal: true,
        },
      },
      uploaded_by: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: { model: "users", key: "id" },
      },
      uploaded_at: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW,
      },
    },
    {
      tableName: "marks",
      paranoid: true,
      timestamps: true,
      indexes: [
        { fields: ["student_id"] },
        { fields: ["subject_id"] },
        { fields: ["class_id"] },
        { fields: ["academic_year_id"] },
        { fields: ["term_id"] },
        { fields: ["sequence_id"] },
      ],
      uniqueKeys: {
        unique_mark: {
          fields: [
            "student_id",
            "subject_id",
            "class_id",
            "academic_year_id",
            "term_id",
            "sequence_id",
          ],
        },
      },
      hooks: {
        beforeCreate: async (mark, options) => {
          await Marks.validateMark(mark);
        },
        beforeUpdate: async (mark, options) => {
          await Marks.validateMark(mark, true);
        },
      },
    }
  );

  // ----- Associations -----
  Marks.associate = (models) => {
    Marks.belongsTo(models.students, {
      foreignKey: "student_id",
      as: "student",
      onDelete: "CASCADE",
    });
    Marks.belongsTo(models.Subject, {
      foreignKey: "subject_id",
      as: "subject",
      onDelete: "CASCADE",
    });
    Marks.belongsTo(models.Class, {
      foreignKey: "class_id",
      as: "class",
      onDelete: "CASCADE",
    });
    Marks.belongsTo(models.AcademicYear, {
      foreignKey: "academic_year_id",
      as: "academic_year",
      onDelete: "CASCADE",
    });
    Marks.belongsTo(models.Term, {
      foreignKey: "term_id",
      as: "term",
      onDelete: "CASCADE",
    });
    Marks.belongsTo(models.Sequence, {
      foreignKey: "sequence_id",
      as: "sequence",
      onDelete: "CASCADE",
    });
    Marks.belongsTo(models.users, {
      foreignKey: "uploaded_by",
      as: "uploader",
      onDelete: "CASCADE",
    });
  };

  // ----- Application-Level Validation -----
  Marks.validateMark = async (data, partial = false) => {
    const errors = [];

    const fields = [
      "student_id",
      "subject_id",
      "class_id",
      "academic_year_id",
      "term_id",
      "sequence_id",
      "score",
      "uploaded_by",
    ];
    for (const key of fields) {
      if (!partial || key in data) {
        if (data[key] === undefined || data[key] === null) {
          errors.push(`${key} is required`);
        } else if (
          key !== "score" &&
          (!Number.isInteger(data[key]) || data[key] <= 0)
        ) {
          errors.push(`${key} must be a positive integer`);
        } else if (
          key === "score" &&
          (typeof data.score !== "number" || data.score < 0 || data.score > 100)
        ) {
          errors.push(`score must be a number between 0 and 100`);
        }
      }
    }

    if (errors.length)
      throw new AppError(errors.join("; "), StatusCodes.BAD_REQUEST);

    // Check uniqueness
    const existing = await Marks.findOne({
      where: {
        student_id: data.student_id,
        subject_id: data.subject_id,
        class_id: data.class_id,
        academic_year_id: data.academic_year_id,
        term_id: data.term_id,
        sequence_id: data.sequence_id,
      },
    });

    if (existing && (!partial || existing.id !== data.id)) {
      throw new AppError(
        "Mark already exists for this student, subject, class, year, term, and sequence",
        StatusCodes.BAD_REQUEST
      );
    }
  };

  return Marks;
};
