"use strict";

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.renameColumn("marks", "created_at", "createdAt");
    await queryInterface.renameColumn("marks", "updated_at", "updatedAt");
    await queryInterface.renameColumn("marks", "deleted_at", "deletedAt");
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.renameColumn("marks", "createdAt", "created_at");
    await queryInterface.renameColumn("marks", "updatedAt", "updated_at");
    await queryInterface.renameColumn("marks", "deletedAt", "deleted_at");
  },
};
