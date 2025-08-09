const Sequelize = require("sequelize");
module.exports = function (sequelize, DataTypes) {
  return sequelize.define(
    "applications",
    {
      id: {
        autoIncrement: true,
        type: DataTypes.INTEGER,
        allowNull: false,
        primaryKey: true,
      },
      applicant_id: {
        type: DataTypes.INTEGER,
        allowNull: true,
        references: {
          model: "users",
          key: "id",
        },
        unique: "applications_applicant_id_key",
      },
      applicant_name: {
        type: DataTypes.STRING(100),
        allowNull: false,
      },
      classes: {
        type: DataTypes.TEXT,
        allowNull: false,
      },
      subjects: {
        type: DataTypes.TEXT,
        allowNull: false,
      },
      contact: {
        type: DataTypes.STRING(50),
        allowNull: false,
      },
      certificate_url: {
        type: DataTypes.STRING(500),
        allowNull: true,
      },
      certificate_name: {
        type: DataTypes.STRING(255),
        allowNull: true,
      },
      status: {
        type: DataTypes.STRING(20),
        allowNull: true,
        defaultValue: "pending",
      },
      admin_comment: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      submitted_at: {
        type: DataTypes.DATE,
        allowNull: true,
        defaultValue: Sequelize.Sequelize.literal("CURRENT_TIMESTAMP"),
      },
      reviewed_at: {
        type: DataTypes.DATE,
        allowNull: true,
      },
      reviewed_by: {
        type: DataTypes.INTEGER,
        allowNull: true,
        references: {
          model: "users",
          key: "id",
        },
      },
    },
    {
      sequelize,
      tableName: "applications",
      schema: "public",
      timestamps: false,
      indexes: [
        {
          name: "applications_applicant_id_key",
          unique: true,
          fields: [{ name: "applicant_id" }],
        },
        {
          name: "applications_pkey",
          unique: true,
          fields: [{ name: "id" }],
        },
      ],
    }
  );
};
