"use strict";

module.exports = {
  async up(queryInterface, Sequelize) {
    // Idempotent: this column+constraint were found already present in
    // production (added out-of-band, never recorded in SequelizeMeta) with
    // an identical definition, so skip whichever piece already exists
    // instead of erroring, that's what let this migration finish recording
    // itself as applied instead of needing a manual SequelizeMeta insert.
    const table = await queryInterface.describeTable("students");
    if (!table.status) {
      await queryInterface.addColumn("students", "status", {
        type: Sequelize.STRING(20),
        allowNull: false,
        defaultValue: "active",
      });
    }

    const [existingConstraint] = await queryInterface.sequelize.query(
      `SELECT 1 FROM pg_constraint WHERE conname = 'students_status_check'`
    );
    if (existingConstraint.length === 0) {
      await queryInterface.sequelize.query(`
        ALTER TABLE students
        ADD CONSTRAINT students_status_check
        CHECK (status IN ('active', 'graduated', 'withdrawn'))
      `);
    }
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.sequelize.query(`
      ALTER TABLE students DROP CONSTRAINT IF EXISTS students_status_check
    `);
    await queryInterface.removeColumn("students", "status");
  },
};
