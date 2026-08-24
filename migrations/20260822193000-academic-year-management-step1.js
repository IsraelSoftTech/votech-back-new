"use strict";

const { pool } = require("../routes/utils");
const { run } = require("../src/db/migrations/academicYearManagement.step1");

/** Sequelize-format migration wrapper (same logic as startup migration). */
module.exports = {
  async up() {
    await run(pool, "sequelize up");
  },

  async down(queryInterface) {
    await queryInterface.sequelize.query(`
      DROP INDEX IF EXISTS uq_academic_years_single_active
    `);
    await queryInterface.dropTable("academic_year_switch_logs");
    await queryInterface.removeColumn("academicYears", "is_locked_for_editing");
    await queryInterface.removeColumn("academicYears", "reactivated_by");
    await queryInterface.removeColumn("academicYears", "reactivated_at");
    await queryInterface.removeColumn("academicYears", "switched_by");
    await queryInterface.removeColumn("academicYears", "switched_at");
  },
};
