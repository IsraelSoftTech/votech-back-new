"use strict";
const { Model, DataTypes } = require("sequelize");

// Generic notification for any long-running academics background job
// (report card sessions today, promotion runs next). The DB row IS the
// notification, not the WebSocket message, deliberately: a socket push
// can be missed if the admin isn't connected at that instant, a persisted
// row can't be. The socket (where used) only ever triggers a refetch of
// this table, it never carries the payload itself.
module.exports = (sequelize, DataTypes) => {
  class AcademicJobNotification extends Model {
    static associate(models) {
      AcademicJobNotification.belongsTo(models.User, {
        foreignKey: "user_id",
        as: "user",
      });
    }
  }

  AcademicJobNotification.init(
    {
      // Null user_id + a role means "everyone with this role", same
      // broadcast semantics used elsewhere in the academics module.
      user_id: {
        type: DataTypes.INTEGER,
        allowNull: true,
        references: { model: "users", key: "id" },
      },
      role: { type: DataTypes.STRING(20), allowNull: true },
      type: {
        type: DataTypes.STRING(50),
        allowNull: false,
        validate: {
          isIn: {
            args: [
              [
                "report_card_run_completed",
                "report_card_run_failed",
                "report_card_session_completed",
                "report_card_session_failed",
                "promotion_run_completed",
                "promotion_run_failed",
              ],
            ],
            msg: "invalid notification type",
          },
        },
      },
      title: { type: DataTypes.STRING(200), allowNull: false },
      message: { type: DataTypes.TEXT, allowNull: true },
      // Frontend route to send the admin straight to the relevant thing,
      // e.g. "/academics/report-cards/sessions/12".
      deep_link: { type: DataTypes.STRING(300), allowNull: true },
      read_at: { type: DataTypes.DATE, allowNull: true },
    },
    {
      sequelize,
      modelName: "AcademicJobNotification",
      tableName: "academic_job_notifications",
      timestamps: true,
      createdAt: "created_at",
      updatedAt: false,
      indexes: [
        { fields: ["user_id", "read_at"] },
        { fields: ["role", "read_at"] },
      ],
    }
  );

  return AcademicJobNotification;
};
