"use strict";
const { Model, DataTypes } = require("sequelize");

module.exports = (sequelize) => {
  class Teacher extends Model {
    static associate(models) {
      Teacher.belongsTo(models.users, { foreignKey: "user_id", as: "user" });
      Teacher.hasMany(models.ClassSubject, {
        foreignKey: "teacher_id",
        as: "classSubjects",
      });
    }
  }

  Teacher.init(
    {
      id: {
        autoIncrement: true,
        type: DataTypes.INTEGER,
        allowNull: false,
        primaryKey: true,
      },
      full_name: { type: DataTypes.STRING(100), allowNull: false },
      sex: { type: DataTypes.STRING(10), allowNull: false },
      id_card: { type: DataTypes.STRING(50), allowNull: false },
      dob: { type: DataTypes.DATEONLY, allowNull: false },
      pob: { type: DataTypes.STRING(100), allowNull: false },
      subjects: { type: DataTypes.STRING(255), allowNull: false },
      classes: { type: DataTypes.STRING(255), allowNull: true },
      contact: { type: DataTypes.STRING(50), allowNull: false },
      status: {
        type: DataTypes.STRING(20),
        allowNull: true,
        defaultValue: "pending",
      },
      user_id: { type: DataTypes.INTEGER, allowNull: true },
      certificate_url: { type: DataTypes.STRING(255), allowNull: true },
      cv_url: { type: DataTypes.STRING(255), allowNull: true },
      photo_url: { type: DataTypes.STRING(255), allowNull: true },
    },
    {
      sequelize,
      modelName: "Teacher",
      tableName: "teachers",
      timestamps: true,
    }
  );

  return Teacher;
};
