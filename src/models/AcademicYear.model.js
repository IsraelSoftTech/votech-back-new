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
      AcademicYear.hasMany(models.marks, { foreignKey: "academic_year_id" });
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

  // Auto-create Terms & Sequences atomically
  // AcademicYear.afterCreate(async (academicYear, options) => {
  //   const termsData = [
  //     { name: "First Term", order_number: 1 },
  //     { name: "Second Term", order_number: 2 },
  //     { name: "Third Term", order_number: 3 },
  //   ];

  //   const sequencesData = [
  //     { name: "1st Sequence", order_number: 1 },
  //     { name: "2nd Sequence", order_number: 2 },
  //     { name: "3rd Sequence", order_number: 3 },
  //     { name: "4th Sequence", order_number: 4 },
  //     { name: "5th Sequence", order_number: 5 },
  //     { name: "6th Sequence", order_number: 6 },
  //   ];

  //   const useOuterTx = Boolean(options?.transaction);
  //   const tx =
  //     options.transaction || (await AcademicYear.sequelize.transaction());

  //   try {
  //     // 1) Create terms
  //     const createdTerms = await Term.bulkCreate(
  //       termsData.map((t) => ({
  //         name: t.name,
  //         order_number: t.order_number,
  //         academic_year_id: academicYear.id,
  //       })),
  //       { transaction: tx, validate: true, returning: true }
  //     );

  //     if (!createdTerms || createdTerms.length !== termsData.length) {
  //       throw new Error("Failed to create all terms for the academic year.");
  //     }

  //     // Ensure proper order for mapping sequences (1&2 -> term1, 3&4 -> term2, 5&6 -> term3)
  //     const sortedTerms = [...createdTerms].sort(
  //       (a, b) => Number(a.order_number) - Number(b.order_number)
  //     );

  //     // 2) Create sequences
  //     const sequencesPayload = sequencesData.map((seq) => {
  //       const termIndex = Math.floor((Number(seq.order_number) - 1) / 2); // 0,1,2
  //       const targetTerm = sortedTerms[termIndex];
  //       if (!targetTerm) {
  //         throw new Error(
  //           `No target term found for sequence ${seq.name} (order ${seq.order_number}).`
  //         );
  //       }
  //       return {
  //         name: seq.name,
  //         order_number: seq.order_number,
  //         term_id: targetTerm.id,
  //         academic_year_id: academicYear.id,
  //       };
  //     });

  //     const createdSequences = await Sequence.bulkCreate(sequencesPayload, {
  //       transaction: tx,
  //       validate: true,
  //     });

  //     if (
  //       !createdSequences ||
  //       createdSequences.length !== sequencesPayload.length
  //     ) {
  //       throw new Error(
  //         "Failed to create all sequences for the academic year."
  //       );
  //     }

  //     if (!useOuterTx) await tx.commit();
  //   } catch (error) {
  //     if (!useOuterTx) {
  //       try {
  //         await tx.rollback();
  //       } catch (_) {}

  //       // Since the AY was created without an outer transaction, undo it explicitly
  //       try {
  //         await AcademicYear.destroy({
  //           where: { id: academicYear.id },
  //           force: true, // paranoid model => ensure real deletion
  //         });
  //       } catch (_) {}
  //     }

  //     throw error;
  //   }
  // });

  return AcademicYear;
};
