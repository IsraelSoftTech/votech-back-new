"use strict";
const { Model, DataTypes } = require("sequelize");

// Year-scoped school identity. school_settings stays a single row holding
// the school's current identity plus the fields that aren't part of a
// document's historical record (contact phone/email, address, motto); this
// table records who the principal was, and what the school was called, in
// a SPECIFIC year.
//
// Every document generator reads this for the year it is generating, so
// reprinting a report card from three years ago still shows the principal
// who actually signed it rather than whoever holds the post today.
module.exports = (sequelize) => {
  class SchoolSettingYear extends Model {
    static associate(models) {
      SchoolSettingYear.belongsTo(models.AcademicYear, {
        foreignKey: "academic_year_id",
        as: "academic_year",
      });
    }
  }

  SchoolSettingYear.init(
    {
      academic_year_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        unique: true,
      },
      school_name: {
        type: DataTypes.STRING(200),
        allowNull: false,
        defaultValue: "",
      },
      principal_name: {
        type: DataTypes.STRING(200),
        allowNull: false,
        defaultValue: "",
      },
    },
    {
      sequelize,
      modelName: "SchoolSettingYear",
      tableName: "school_setting_years",
      timestamps: true,
      createdAt: "created_at",
      updatedAt: "updated_at",
    }
  );

  return SchoolSettingYear;
};
