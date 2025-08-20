"use strict";
const { Model, DataTypes } = require("sequelize");

module.exports = (sequelize) => {
  class ReportCardComment extends Model {
    static associate(models) {
      ReportCardComment.belongsTo(models.AcademicYear, {
        foreignKey: "academic_year_id",
      });
      ReportCardComment.belongsTo(models.Class, { foreignKey: "class_id" });
    }
  }
  ReportCardComment.init(
    {
      band_min: { type: DataTypes.INTEGER, allowNull: false },
      band_max: { type: DataTypes.INTEGER, allowNull: false },
      comment: { type: DataTypes.TEXT, allowNull: false },
      academic_year_id: { type: DataTypes.INTEGER, allowNull: false },
      class_id: { type: DataTypes.INTEGER, allowNull: false },
    },
    {
      sequelize,
      modelName: "ReportCardComment",
      tableName: "report_card_comments",
      timestamps: true,
    }
  );
  return ReportCardComment;
};
