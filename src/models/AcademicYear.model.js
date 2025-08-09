"use strict";
const { Model, DataTypes } = require("sequelize");

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
      name: DataTypes.STRING,
      start_date: DataTypes.DATE,
      end_date: DataTypes.DATE,
      status: DataTypes.ENUM("active", "archived"),
    },
    { sequelize, modelName: "AcademicYear" }
  );
  return AcademicYear;
};
