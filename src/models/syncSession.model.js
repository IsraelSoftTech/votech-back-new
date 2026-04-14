"use strict";
const { Model, DataTypes } = require("sequelize");

module.exports = (sequelize) => {
  class SyncSession extends Model {
    static associate(models) {
      SyncSession.belongsTo(models.User, { foreignKey: "user_id" });
    }
  }

  SyncSession.init(
    {
      id: {
        type: DataTypes.UUID,
        defaultValue: DataTypes.UUIDV4,
        primaryKey: true,
      },
      user_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: {
          model: "users",
          key: "id",
        },
        onDelete: "CASCADE",
      },
      device_token: {
        type: DataTypes.STRING(255),
        allowNull: false,
      },
      status: {
        type: DataTypes.ENUM(
          "pending",
          "queued",
          "in_progress",
          "complete",
          "failed",
          "abandoned"
        ),
        allowNull: false,
        defaultValue: "pending",
      },
      queue_position: {
        type: DataTypes.INTEGER,
        allowNull: true,
        defaultValue: null,
      },
      manifest: {
        type: DataTypes.JSONB,
        allowNull: true,
        defaultValue: null,
      },
      checkpoint: {
        type: DataTypes.JSONB,
        allowNull: true,
        defaultValue: null,
      },
      scope_version: {
        type: DataTypes.INTEGER,
        allowNull: false,
        defaultValue: 1,
      },
      started_at: {
        type: DataTypes.DATE,
        allowNull: true,
        defaultValue: null,
      },
      completed_at: {
        type: DataTypes.DATE,
        allowNull: true,
        defaultValue: null,
      },
      last_ack_at: {
        type: DataTypes.DATE,
        allowNull: true,
        defaultValue: null,
      },
    },
    {
      sequelize,
      modelName: "SyncSession",
      tableName: "sync_sessions",
      freezeTableName: true,
      timestamps: true,
      createdAt: "created_at",
      updatedAt: "updated_at",
    }
  );

  return SyncSession;
};
