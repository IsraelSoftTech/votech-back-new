"use strict";

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn("students", "accademic_year_id", {
      type: Sequelize.STRING,
      allowNull: true,
    });

    await queryInterface.addColumn("students", "createdAt", {
      allowNull: false,
      type: Sequelize.DATE,
      defaultValue: Sequelize.literal("CURRENT_TIMESTAMP"),
    });

    await queryInterface.addColumn("students", "updatedAt", {
      allowNull: false,
      type: Sequelize.DATE,
      defaultValue: Sequelize.literal("CURRENT_TIMESTAMP"),
    });

    await queryInterface.addColumn("students", "deletedAt", {
      type: Sequelize.DATE,
      allowNull: true,
    });
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.removeColumn("students", "accademic_year_id");
    await queryInterface.removeColumn("students", "createdAt");
    await queryInterface.removeColumn("students", "updatedAt");
    await queryInterface.removeColumn("students", "deletedAt");
  },
};
