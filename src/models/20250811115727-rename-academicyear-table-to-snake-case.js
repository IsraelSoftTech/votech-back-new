"use strict";

module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.removeConstraint(
      "sequences",
      "sequences_academic_year_id_fkey1"
    );

    await queryInterface.addConstraint("sequences", {
      fields: ["academic_year_id"],
      type: "foreign key",
      name: "sequences_academic_year_id_fkey1",
      references: {
        table: "academicYears",
        field: "id",
      },
      onUpdate: "CASCADE",
      onDelete: "RESTRICT",
    });
  },

  down: async (queryInterface, Sequelize) => {
    await queryInterface.removeConstraint(
      "sequences",
      "sequences_academic_year_id_fkey1"
    );
  },
};
