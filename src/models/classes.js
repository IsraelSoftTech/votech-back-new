"use strict";
const { Model, DataTypes } = require("sequelize");

module.exports = (sequelize) => {
  class Class extends Model {
    static associate(models) {
      Class.hasMany(models.ClassSubject, {
        foreignKey: "class_id",
        as: "classSubjects",
      });
    }
  }

  Class.init(
    {
      id: {
        autoIncrement: true,
        type: DataTypes.INTEGER,
        allowNull: false,
        primaryKey: true,
      },
      name: {
        type: DataTypes.STRING(100),
        allowNull: false,
      },
      registration_fee: DataTypes.STRING(50),
      bus_fee: DataTypes.STRING(50),
      internship_fee: DataTypes.STRING(50),
      remedial_fee: DataTypes.STRING(50),
      tuition_fee: DataTypes.STRING(50),
      pta_fee: DataTypes.STRING(50),
      total_fee: DataTypes.STRING(50),
      suspended: {
        type: DataTypes.BOOLEAN,
        allowNull: true,
        defaultValue: false,
      },
    },
    {
      sequelize,
      modelName: "Class",
      tableName: "classes",
      timestamps: true,
    }
  );

  return Class;
};
