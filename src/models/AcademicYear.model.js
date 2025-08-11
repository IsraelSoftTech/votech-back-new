"use strict";
const { Model, DataTypes } = require("sequelize");
const { Op } = require("sequelize");
const { StatusCodes } = require("http-status-codes");
const AppError = require("../utils/AppError");

module.exports = (sequelize) => {
  class AcademicYear extends Model {
    static associate(models) {
      AcademicYear.hasMany(models.Sequence, { foreignKey: "academic_year_id" });
      AcademicYear.hasMany(models.Mark, { foreignKey: "academic_year_id" });
      AcademicYear.hasMany(models.ReportCardComment, {
        foreignKey: "academic_year_id",
      });
      AcademicYear.hasMany(models.ReportCardSnapshot, {
        foreignKey: "academic_year_id",
      });
    }
  }
  AcademicYear.init(
    {
      name: {
        type: DataTypes.STRING,
        allowNull: false,
        unique: true,
        validate: {
          notEmpty: true,
        },
      },
      start_date: {
        type: DataTypes.DATEONLY,
        allowNull: false,
        validate: {
          isDate: true,
          isValidRange(value) {
            const year = new Date(value).getFullYear();
            if (year < 1900 || year > 2100) {
              throw new Error("Start date year must be between 1900 and 2100");
            }
          },
        },
      },
      end_date: {
        type: DataTypes.DATEONLY,
        allowNull: false,
        validate: {
          isDate: true,
          isValidRange(value) {
            const year = new Date(value).getFullYear();
            if (year < 1900 || year > 2100) {
              throw new Error("End date year must be between 1900 and 2100");
            }
          },
        },
      },
      status: {
        type: DataTypes.ENUM("active", "archived"),
        allowNull: false,
      },
    },
    {
      sequelize,
      modelName: "AcademicYear",
      tableName: "academicYears",
      freezeTableName: true,
      paranoid: true,
    }
  );

  return AcademicYear;
};
