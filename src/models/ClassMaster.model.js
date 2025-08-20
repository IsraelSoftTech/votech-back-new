"use strict";
const { Model, DataTypes } = require("sequelize");

module.exports = (sequelize) => {
  class ClassMaster extends Model {
    static associate(models) {
      // One ClassMaster has many Class records
      ClassMaster.hasMany(models.Class, {
        foreignKey: "classMasterId",
        as: "classes",
      });

      // Many-to-Many with Users through a pivot table
      ClassMaster.belongsToMany(models.User, {
        through: "ClassMasterUsers",
        foreignKey: "classMasterId",
        otherKey: "userId",
        as: "users",
      });
    }
  }

  ClassMaster.init(
    {
      id: {
        autoIncrement: true,
        type: DataTypes.INTEGER,
        allowNull: false,
        primaryKey: true,
      },
      class_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },
      teacher_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },
    },
    {
      sequelize,
      modelName: "ClassMaster",
      tableName: "class_masters",
      timestamps: true,
    }
  );

  return ClassMaster;
};
