"use strict";

const { DataTypes } = require("sequelize");
const { sequelize } = require("../db");

const User = require("./users")(sequelize);

module.exports = (sequelizeInstance = sequelize) => {
  const DbSwapLog = sequelizeInstance.define(
    "db_swap_logs",
    {
      id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },
      mode: {
        type: DataTypes.ENUM("online", "offline", "maintenance"),
        allowNull: false,
      },
      action: {
        type: DataTypes.ENUM("backup", "restore"),
        allowNull: false,
      },
      file_name: {
        type: DataTypes.STRING,
        allowNull: false,
      },
      file_path: {
        type: DataTypes.STRING,
        allowNull: false, // FTP remote path
      },
      size_bytes: {
        type: DataTypes.BIGINT,
        allowNull: true,
      },
      created_at: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW,
      },
      created_by: {
        type: DataTypes.INTEGER,
        allowNull: true,
        references: { model: "users", key: "id" },
      },
    },
    {
      tableName: "db_swap_logs",
      timestamps: false,
    }
  );

  DbSwapLog.belongsTo(User, { foreignKey: "created_by", as: "user" });

  return DbSwapLog;
};
