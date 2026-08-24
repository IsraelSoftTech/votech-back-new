"use strict";
const { Model, DataTypes } = require("sequelize");

module.exports = (sequelize) => {
  class Class extends Model {
    static associate(models) {
      // Class → ClassSubjects
      Class.hasMany(models.ClassSubject, {
        foreignKey: "class_id",
        as: "classSubjects",
      });

      // Class → Department (Specialty)
      Class.belongsTo(models.Specialty, {
        foreignKey: "department_id",
        as: "department",
      });

      // Class → Class Master (User)
      Class.belongsTo(models.User, {
        foreignKey: "class_master_id",
        as: "classMaster",
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
      registration_fee: {
        type: DataTypes.FLOAT,
        allowNull: true,
        defaultValue: 0,
      },
      bus_fee: {
        type: DataTypes.FLOAT,
        allowNull: true,
        defaultValue: 0,
      },
      internship_fee: {
        type: DataTypes.FLOAT,
        allowNull: true,
        defaultValue: 0,
      },
      remedial_fee: {
        type: DataTypes.FLOAT,
        allowNull: true,
        defaultValue: 0,
      },
      tuition_fee: {
        type: DataTypes.FLOAT,
        allowNull: true,
        defaultValue: 0,
      },
      pta_fee: {
        type: DataTypes.FLOAT,
        allowNull: true,
        defaultValue: 0,
      },
      total_fee: {
        type: DataTypes.FLOAT,
        allowNull: true,
        defaultValue: 0,
      },
      suspended: {
        type: DataTypes.BOOLEAN,
        allowNull: true,
        defaultValue: false,
      },
      class_master_id: {
        type: DataTypes.INTEGER,
        allowNull: true,
        references: { model: "users", key: "id" },
      },
      department_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: { model: "specialties", key: "id" },
      },
      // Orientation (Form One) classes fan out to a student's chosen
      // department at promotion time instead of a single fixed
      // destination class — this flag is what the registration form,
      // promotion, and the class-creation UI all key off of to know a
      // class needs that treatment, rather than matching on name.
      is_orientation: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      },
    },
    {
      sequelize,
      modelName: "Class",
      tableName: "classes",
      timestamps: true,
      indexes: [
        {
          unique: true,
          fields: ["name", "department_id"],
        },
      ],
    }
  );

  return Class;
};
