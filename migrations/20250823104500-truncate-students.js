"use strict";

module.exports = {
  async up(queryInterface, Sequelize) {
    // Disable FK checks where supported and clear dependent tables first
    // Clear fees referencing students if exists
    try {
      await queryInterface.sequelize.query("TRUNCATE TABLE fees RESTART IDENTITY CASCADE;");
    } catch (e) {
      // ignore if fees table doesn't exist
    }
    // Clear students table
    await queryInterface.sequelize.query("TRUNCATE TABLE students RESTART IDENTITY CASCADE;");
  },

  async down(queryInterface, Sequelize) {
    // Irreversible data truncation; no-op on down
  },
};
