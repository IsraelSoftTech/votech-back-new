"use strict";
const { Model, DataTypes } = require("sequelize");

module.exports = (sequelize) => {
  class Sequence extends Model {
    static associate(models) {
      Sequence.belongsTo(models.AcademicYear, {
        foreignKey: "academic_year_id",
      });
      Sequence.hasMany(models.Mark, { foreignKey: "sequence_id" });
      Sequence.hasMany(models.ReportCardSnapshot, {
        foreignKey: "sequence_id",
      });
    }
  }
  Sequence.init(
    {
      name: { type: DataTypes.STRING, allowNull: false },
      type: { type: DataTypes.ENUM("sequence", "term"), allowNull: false },
      order_number: { type: DataTypes.INTEGER, allowNull: false },
      academic_year_id: { type: DataTypes.INTEGER, allowNull: false },
    },
    {
      sequelize,
      modelName: "Sequence",
      tableName: "sequences",
      timestamps: true,
    }
  );
  return Sequence;
};
