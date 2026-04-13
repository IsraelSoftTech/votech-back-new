"use strict";
const { Model } = require("sequelize");

module.exports = (sequelize, DataTypes) => {
  class UserDevice extends Model {
    static associate(models) {
      UserDevice.belongsTo(models.users, {
        foreignKey: "user_id",
        as: "user",
      });

      // The admin who approved the unbind
      UserDevice.belongsTo(models.users, {
        foreignKey: "unbound_by",
        as: "unboundByUser",
      });
    }
  }

  UserDevice.init(
    {
      user_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },
      device_id: {
        type: DataTypes.TEXT,
        allowNull: false,
        unique: true,
      },
      device_type: {
        type: DataTypes.TEXT,
        allowNull: false,
        defaultValue: "desktop",
      },
      device_os: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      device_status: {
        type: DataTypes.TEXT,
        allowNull: false,
        defaultValue: "bound",
      },
      registered_at: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW,
      },
      last_seen_at: {
        type: DataTypes.DATE,
        allowNull: true,
      },
      unbound_at: {
        type: DataTypes.DATE,
        allowNull: true,
      },
      unbound_by: {
        type: DataTypes.INTEGER,
        allowNull: true,
      },
    },
    {
      sequelize,
      modelName: "UserDevice",
      tableName: "user_devices",
      timestamps: false,
    }
  );

  return UserDevice;
};
