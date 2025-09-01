"use strict";

module.exports = {
  async up(queryInterface, Sequelize) {
    // Add createdAt and updatedAt
    await queryInterface.addColumn("students", "createdAt", {
      type: Sequelize.DATE,
      allowNull: false,
      defaultValue: Sequelize.literal("CURRENT_TIMESTAMP"),
    });

    await queryInterface.addColumn("students", "updatedAt", {
      type: Sequelize.DATE,
      allowNull: false,
      defaultValue: Sequelize.literal("CURRENT_TIMESTAMP"),
    });

    // Add deletedAt (for paranoid / soft delete)
    await queryInterface.addColumn("students", "deletedAt", {
      type: Sequelize.DATE,
      allowNull: true,
    });
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.removeColumn("students", "createdAt");
    await queryInterface.removeColumn("students", "updatedAt");
    await queryInterface.removeColumn("students", "deletedAt");
  },
};
