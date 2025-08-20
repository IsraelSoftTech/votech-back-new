"use strict";

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.removeConstraint(
      "academic_bands",
      "academic_bands_academic_year_id_fkey"
    );
    await queryInterface.addConstraint("academic_bands", {
      fields: ["academic_year_id"],
      type: "foreign key",
      name: "academic_bands_academic_year_id_fkey",
      references: {
        table: "academicYears", // actual DB table name, not model name
        field: "id",
      },
      onDelete: "CASCADE",
      onUpdate: "CASCADE",
    });
  },

  async down(queryInterface, Sequelize) {
    // revert back if needed
  },
};
