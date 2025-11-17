const Sequelize = require("sequelize");
const { sequelize } = require("../db");
const { DataTypes } = require("sequelize");

module.exports = (sequelizeInstance = sequelize) => {
  return sequelizeInstance.define(
    "users",
    {
      id: {
        autoIncrement: true,
        type: DataTypes.INTEGER,
        allowNull: false,
        primaryKey: true,
      },
      username: {
        type: DataTypes.STRING(50),
        allowNull: false,
        unique: "users_username_key",
        validate: {
          notEmpty: true,
          len: [3, 50],
        },
      },
      contact: {
        type: DataTypes.STRING(50),
        allowNull: true,
        validate: {
          len: [0, 50],
        },
      },
      password: {
        type: DataTypes.STRING(255),
        allowNull: false,
      },
      name: {
        type: DataTypes.STRING(100),
        allowNull: true,
        validate: {
          len: [0, 100],
        },
      },
      email: {
        type: DataTypes.STRING(255),
        allowNull: true,
        validate: {
          isEmail: true,
          len: [0, 255],
        },
      },
      gender: {
        type: DataTypes.STRING(20),
        allowNull: true,
      },
      role: {
        type: DataTypes.STRING(20),
        allowNull: false,
        validate: {
          notEmpty: true,
        },
      },
      suspended: {
        type: DataTypes.BOOLEAN,
        allowNull: true,
        defaultValue: false,
      },
    },
    {
      sequelize,
      tableName: "users",
      schema: "public",
      timestamps: true,
      indexes: [
        {
          name: "users_pkey",
          unique: true,
          fields: [{ name: "id" }],
        },
        {
          name: "users_username_key",
          unique: true,
          fields: [{ name: "username" }],
        },
      ],
    }
  );
};
