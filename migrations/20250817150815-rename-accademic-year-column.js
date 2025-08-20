"use strict";

module.exports = {
  up: async (queryInterface, Sequelize) => {
    // Rename column accademic_year_id → academic_year_id
    await queryInterface.renameColumn(
      "students", // table name
      "accademic_year_id", // old column name
      "academic_year_id" // new column name
    );
  },

  down: async (queryInterface, Sequelize) => {
    // Rollback: rename back
    await queryInterface.renameColumn(
      "students",
      "academic_year_id",
      "accademic_year_id"
    );
  },
};
