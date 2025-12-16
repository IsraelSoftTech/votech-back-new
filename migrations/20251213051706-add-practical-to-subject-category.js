"use strict";

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.sequelize.query(`
      ALTER TYPE "enum_subjects_category"
      ADD VALUE IF NOT EXISTS 'practical';
    `);
  },

  async down(queryInterface, Sequelize) {
    // ENUM values CANNOT be removed safely in Postgres
    // Down migration intentionally left empty
  },
};
