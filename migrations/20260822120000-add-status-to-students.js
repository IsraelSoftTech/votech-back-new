"use strict";

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn("students", "status", {
      type: Sequelize.STRING(20),
      allowNull: false,
      defaultValue: "active",
    });

    await queryInterface.sequelize.query(`
      ALTER TABLE students
      ADD CONSTRAINT students_status_check
      CHECK (status IN ('active', 'graduated', 'withdrawn'))
    `);
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.sequelize.query(`
      ALTER TABLE students DROP CONSTRAINT IF EXISTS students_status_check
    `);
    await queryInterface.removeColumn("students", "status");
  },
};
