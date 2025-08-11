"use strict";
const { Model, DataTypes } = require("sequelize");

const { sequelize } = require("../db");
const dt = require("../db").DataTypes;

const Term = require("./Term.model")(sequelize, dt);
const Sequence = require("./Sequence.model")(sequelize, dt);

module.exports = (sequelize) => {
  class AcademicYear extends Model {
    static associate(models) {
      AcademicYear.hasMany(models.Sequence, { foreignKey: "academic_year_id" });
      AcademicYear.hasMany(models.Term, { foreignKey: "academic_year_id" });
      AcademicYear.hasMany(models.Mark, { foreignKey: "academic_year_id" });
      AcademicYear.hasMany(models.ReportCardComment, {
        foreignKey: "academic_year_id",
      });
      AcademicYear.hasMany(models.ReportCardSnapshot, {
        foreignKey: "academic_year_id",
      });
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
    },
    {
      sequelize,
      modelName: "AcademicYear",
      tableName: "academicYears",
      freezeTableName: true,
      paranoid: true,
    }
  );

  // 🔹 Hook: Auto-create Terms & Sequences

  AcademicYear.afterCreate(async (academicYear, options) => {
    console.log(academicYear);
    const termsData = [
      { name: "First Term", order_number: 1 },
      { name: "Second Term", order_number: 2 },
      { name: "Third Term", order_number: 3 },
    ];

    const sequencesData = [
      { name: "1st Sequence", order_number: 1 },
      { name: "2nd Sequence", order_number: 2 },
      { name: "3rd Sequence", order_number: 3 },
      { name: "4th Sequence", order_number: 4 },
      { name: "5th Sequence", order_number: 5 },
      { name: "6th Sequence", order_number: 6 },
    ];

    const transaction = options.transaction || (await sequelize.transaction());

    try {
      const createdTerms = [];
      for (const term of termsData) {
        const createdTerm = await Term.create(
          {
            name: term.name,
            order_number: term.order_number,
            academic_year_id: academicYear.dataValues.id,
          },
          { transaction }
        );
        createdTerms.push(createdTerm);
      }

      let seqIndex = 0;
      for (const term of createdTerms) {
        for (let i = 0; i < 2; i++) {
          await Sequence.create(
            {
              name: sequencesData[seqIndex].name,
              order_number: sequencesData[seqIndex].order_number,
              term_id: term.id,
              academic_year_id: academicYear.dataValues.id,
            },
            { transaction }
          );
          seqIndex++;
        }
      }

      if (!options.transaction) {
        await transaction.commit();
      }
    } catch (error) {
      if (!options.transaction) {
        await transaction.rollback();
      }
      throw error;
    }
  });

  return AcademicYear;
};
