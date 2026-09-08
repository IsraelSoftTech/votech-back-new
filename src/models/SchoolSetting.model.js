"use strict";

const { DataTypes } = require("sequelize");

// Single-row settings table (id is always 1) — every document generator
// (report cards, master sheets, marks-overview PDF, transcripts) reads
// this instead of hardcoding the principal's name / school identity, so
// changing it once actually changes it everywhere.
module.exports = (sequelizeInstance) => {
  const SchoolSetting = sequelizeInstance.define(
    "school_settings",
    {
      id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        defaultValue: 1,
      },
      school_name: {
        type: DataTypes.STRING(200),
        allowNull: false,
        defaultValue: "Votech S7 Academy",
      },
      principal_name: {
        type: DataTypes.STRING(200),
        allowNull: false,
        defaultValue: "",
      },
      contact_phone: {
        type: DataTypes.STRING(50),
        allowNull: true,
      },
      contact_email: {
        type: DataTypes.STRING(150),
        allowNull: true,
      },
      address: {
        type: DataTypes.STRING(250),
        allowNull: true,
      },
      motto: {
        type: DataTypes.STRING(250),
        allowNull: true,
      },
    },
    {
      tableName: "school_settings",
      timestamps: true,
      createdAt: "created_at",
      updatedAt: "updated_at",
    }
  );

  return SchoolSetting;
};
