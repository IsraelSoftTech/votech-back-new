"use strict";
const { Model, DataTypes } = require("sequelize");

module.exports = (sequelize, DataTypes) => {
  class Subject extends Model {
    static associate(models) {
      Subject.hasMany(models.ClassSubject, {
        foreignKey: "subject_id",
        as: "classSubjects",
      });
      Subject.hasMany(models.marks, { foreignKey: "subject_id", as: "marks" });
    }
  }

  Subject.init(
    {
      name: {
        type: DataTypes.STRING,
        allowNull: false,
        validate: {
          notEmpty: { msg: "Name cannot be empty" },
          len: {
            args: [2, 100],
            msg: "Name length must be between 2 and 100 characters",
          },
        },
      },
      code: {
        type: DataTypes.STRING,
        allowNull: true,
        unique: true,
        validate: {
          notEmpty: { msg: "Code cannot be empty if provided" },
          len: {
            args: [2, 20],
            msg: "Code length must be between 2 and 20 characters",
          },
          is: {
            args: /^[A-Z0-9\-]+$/i,
            msg: "Code can only contain letters, numbers, and dashes",
          },
        },
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
        type: DataTypes.ENUM("general", "professional", "practical"),
        allowNull: false,
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
      modelName: "Subject",
      tableName: "subjects",
      timestamps: true,
    }
  );

  return Subject;
};
