// models/academicBand.model.js
"use strict";

const { DataTypes } = require("sequelize");
const { sequelize } = require("../db");

module.exports = (sequelizeInstance = sequelize) => {
  const AcademicBand = sequelizeInstance.define(
    "academic_bands",
    {
      id: {
        type: DataTypes.INTEGER,
        autoIncrement: true,
        primaryKey: true,
      },
      band_min: {
        type: DataTypes.DOUBLE,
        allowNull: false,
        validate: {
          min: {
            args: [0],
            msg: "Minimum band cannot be negative",
          },
          isInt: {
            msg: "Minimum band must be an integer",
          },
        },
      },
      band_max: {
        type: DataTypes.DOUBLE,
        allowNull: false,
        validate: {
          min: {
            args: [0],
            msg: "Maximum band cannot be negative",
          },
          isInt: {
            msg: "Maximum band must be an integer",
          },
          isGreaterThanMin(value) {
            if (value < this.band_min) {
              throw new Error(
                "Maximum band must be greater than or equal to minimum band"
              );
            }
          },
        },
      },
      comment: {
        type: DataTypes.TEXT,
        allowNull: false,
        validate: {
          notEmpty: {
            msg: "Comment cannot be empty",
          },
        },
      },
      academic_year_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: {
          model: "AcademicYear",
          key: "id",
        },
      },
      class_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: {
          model: "classes",
          key: "id",
        },
      },
      created_at: {
        type: DataTypes.DATE,
        defaultValue: DataTypes.NOW,
      },
      updated_at: {
        type: DataTypes.DATE,
        defaultValue: DataTypes.NOW,
      },
    },
    {
      timestamps: true,
      createdAt: "created_at",
      updatedAt: "updated_at",
      indexes: [
        {
          unique: true,
          fields: ["academic_year_id", "class_id", "band_min", "band_max"],
        },
      ],
    }
  );

  AcademicBand.associate = (models) => {
    AcademicBand.belongsTo(models.AcademicYear, {
      foreignKey: "academic_year_id",
      as: "academic_year",
      onDelete: "CASCADE",
    });

    AcademicBand.belongsTo(models.Class, {
      foreignKey: "class_id",
      as: "class",
      onDelete: "CASCADE",
    });
  };

  return AcademicBand;
};
