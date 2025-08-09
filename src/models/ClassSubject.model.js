"use strict";
const { Model, DataTypes } = require("sequelize");

module.exports = (sequelize) => {
  class ClassSubject extends Model {
    static associate(models) {
      ClassSubject.belongsTo(models.Class, { foreignKey: "class_id" });
      ClassSubject.belongsTo(models.Subject, { foreignKey: "subject_id" });
      ClassSubject.belongsTo(models.User, { foreignKey: "teacher_id" });
    }
  }
  ClassSubject.init(
    {
      class_id: { type: DataTypes.INTEGER, allowNull: false },
      subject_id: { type: DataTypes.INTEGER, allowNull: false },
      teacher_id: { type: DataTypes.INTEGER, allowNull: false },
    },
    {
      sequelize,
      modelName: "ClassSubject",
      tableName: "class_subjects",
      timestamps: true,
    }
  );
  return ClassSubject;
};
