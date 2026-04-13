"use strict";
const { Model } = require("sequelize");

module.exports = (sequelize, DataTypes) => {
  class DeviceUnbindRequest extends Model {
    static associate(models) {
      DeviceUnbindRequest.belongsTo(models.users, {
        foreignKey: "user_id",
        as: "user",
      });
      DeviceUnbindRequest.belongsTo(models.users, {
        foreignKey: "requested_by",
        as: "requestedByUser",
      });
      DeviceUnbindRequest.belongsTo(models.users, {
        foreignKey: "approved_by",
        as: "approvedByUser",
      });
      DeviceUnbindRequest.belongsTo(models.users, {
        foreignKey: "rejected_by",
        as: "rejectedByUser",
      });
      DeviceUnbindRequest.belongsTo(models.UserDevice, {
        foreignKey: "device_id",
        targetKey: "device_id",
        as: "device",
      });
    }
  }

  DeviceUnbindRequest.init(
    {
      user_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },
      device_id: {
        type: DataTypes.TEXT,
        allowNull: false,
      },
      requested_at: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW,
      },
      requested_by: {
        type: DataTypes.INTEGER,
        allowNull: true, // null means the user requested it themselves
      },
      approved_by: {
        type: DataTypes.INTEGER,
        allowNull: true,
      },
      approved_at: {
        type: DataTypes.DATE,
        allowNull: true,
      },
      rejected_by: {
        type: DataTypes.INTEGER,
        allowNull: true,
      },
      rejected_at: {
        type: DataTypes.DATE,
        allowNull: true,
      },
      reason: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      status: {
        type: DataTypes.TEXT,
        allowNull: false,
        defaultValue: "pending", // pending | approved | rejected
      },
    },
    {
      sequelize,
      modelName: "DeviceUnbindRequest",
      tableName: "device_unbind_requests",
      timestamps: false,
    }
  );

  return DeviceUnbindRequest;
};
