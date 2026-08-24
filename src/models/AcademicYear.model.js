"use strict";
const { Model, DataTypes } = require("sequelize");

module.exports = (sequelize) => {
  class AcademicYear extends Model {
    static associate(models) {
      AcademicYear.hasMany(models.Sequence, {
        foreignKey: "academic_year_id",
      });
      AcademicYear.hasMany(models.Term, {
        foreignKey: "academic_year_id",
      });
      AcademicYear.hasMany(models.Mark, {
        foreignKey: "academic_year_id",
      });
      if (models.AcademicYearSwitchLog) {
        AcademicYear.hasMany(models.AcademicYearSwitchLog, {
          foreignKey: "from_year_id",
          as: "switchLogsFrom",
        });
        AcademicYear.hasMany(models.AcademicYearSwitchLog, {
          foreignKey: "to_year_id",
          as: "switchLogsTo",
        });
      }
      if (models.User) {
        AcademicYear.belongsTo(models.User, {
          foreignKey: "switched_by",
          as: "switchedByUser",
        });
        AcademicYear.belongsTo(models.User, {
          foreignKey: "reactivated_by",
          as: "reactivatedByUser",
        });
      }
    }
  }

  AcademicYear.init(
    {
      name: {
        type: DataTypes.STRING,
        allowNull: false,
        unique: true,
        validate: {
          notEmpty: true,
        },
      },
      start_date: {
        type: DataTypes.DATEONLY,
        allowNull: false,
        validate: {
          isDate: true,
          isValidRange(value) {
            const year = new Date(value).getFullYear();
            if (year < 1900 || year > 2100) {
              throw new Error("Start date year must be between 1900 and 2100");
            }
          },
        },
      },
      end_date: {
        type: DataTypes.DATEONLY,
        allowNull: false,
        validate: {
          isDate: true,
          isValidRange(value) {
            const year = new Date(value).getFullYear();
            if (year < 1900 || year > 2100) {
              throw new Error("End date year must be between 1900 and 2100");
            }
          },
        },
      },
      status: {
        type: DataTypes.ENUM("active", "archived"),
        allowNull: false,
      },
      switched_at: {
        type: DataTypes.DATE,
        allowNull: true,
      },
      switched_by: {
        type: DataTypes.INTEGER,
        allowNull: true,
      },
      reactivated_at: {
        type: DataTypes.DATE,
        allowNull: true,
      },
      reactivated_by: {
        type: DataTypes.INTEGER,
        allowNull: true,
      },
      is_locked_for_editing: {
        type: DataTypes.BOOLEAN,
        allowNull: false,
        defaultValue: false,
      },
    },
    {
      sequelize,
      modelName: "AcademicYear",
      tableName: "academicYears",
      freezeTableName: true,
      paranoid: true,
    }
  );

  return AcademicYear;
};
