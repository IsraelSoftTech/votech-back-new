"use strict";
const { Model, DataTypes } = require("sequelize");

module.exports = (sequelize) => {
  class ReportCardSnapshot extends Model {
    static associate(models) {
      ReportCardSnapshot.belongsTo(models.students, {
        foreignKey: "student_id",
      });
      ReportCardSnapshot.belongsTo(models.AcademicYear, {
        foreignKey: "academic_year_id",
      });
      ReportCardSnapshot.belongsTo(models.Sequence, {
        foreignKey: "sequence_id",
      });
      ReportCardSnapshot.belongsTo(models.users, {
        foreignKey: "generated_by",
      });
    }
  }
  ReportCardSnapshot.init(
    {
      student_id: { type: DataTypes.INTEGER, allowNull: false },
      academic_year_id: { type: DataTypes.INTEGER, allowNull: false },
      sequence_id: { type: DataTypes.INTEGER, allowNull: false },
      term_or_annual: {
        type: DataTypes.ENUM("sequence", "term", "annual"),
        allowNull: false,
      },
      data: { type: DataTypes.JSON, allowNull: false },
      generated_by: { type: DataTypes.INTEGER, allowNull: false },
      generated_at: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW,
      },
    },
    {
      sequelize,
      modelName: "ReportCardSnapshot",
      tableName: "report_card_snapshots",
      timestamps: false,
    }
  );
  return ReportCardSnapshot;
};
