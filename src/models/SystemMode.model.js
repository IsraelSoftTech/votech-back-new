"use strict";

const { DataTypes } = require("sequelize");
const { sequelize } = require("../db");

module.exports = (sequelizeInstance = sequelize) => {
  const SystemMode = sequelizeInstance.define(
    "system_mode",
    {
      mode: {
        type: DataTypes.ENUM("online", "offline", "mirror"),
        allowNull: false,
        primaryKey: true,
        defaultValue: "online",
      },
    },
    {
      tableName: "system_mode",
      timestamps: false,
    }
  );

  return SystemMode;
};
