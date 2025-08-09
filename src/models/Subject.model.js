"use strict";
const { Model, DataTypes } = require("sequelize");

module.exports = (sequelize) => {
  class Subject extends Model {
    static associate(models) {
      Subject.hasMany(models.ClassSubject, { foreignKey: "subject_id" });
      Subject.hasMany(models.Mark, { foreignKey: "subject_id" });
    }
  }
  Subject.init(
    {
      name: { type: DataTypes.STRING, allowNull: false },
      code: { type: DataTypes.STRING, allowNull: true },
      coefficient: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 1,
      },
      category: {
        type: DataTypes.ENUM("general", "professional"),
        allowNull: false,
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
