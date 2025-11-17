"use strict";

const { DataTypes } = require("sequelize");
const { sequelize } = require("../db");

const User = require("./users")(sequelize);

module.exports = (sequelizeInstance = sequelize) => {
  const ChangeLog = sequelizeInstance.define(
    "change_logs",
    {
      id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },
      table_name: {
        type: DataTypes.STRING,
        allowNull: false,
      },
      record_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },
      change_type: {
        type: DataTypes.ENUM("INSERT", "UPDATE", "DELETE"),
        allowNull: false,
      },
      changed_at: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW,
      },
      changed_by: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: { model: "users", key: "id" },
      },
      fields_changed: {
        type: DataTypes.JSONB,
        allowNull: true,
      },
      source: {
        type: DataTypes.ENUM("local", "online"),
        allowNull: false,
        defaultValue: "local",
      },
      synced: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      },
    },
    {
      tableName: "change_logs",
      timestamps: false,
    }
  );

  ChangeLog.belongsTo(User, { foreignKey: "changed_by", as: "user" });

  return ChangeLog;
};
