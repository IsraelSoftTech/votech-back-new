"use strict";

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn("users", "createdAt", {
      type: Sequelize.DATE,
      allowNull: false,
      defaultValue: Sequelize.fn("NOW"),
    });
    await queryInterface.addColumn("users", "updatedAt", {
      type: Sequelize.DATE,
      allowNull: false,
      defaultValue: Sequelize.fn("NOW"),
    });
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.removeColumn("users", "createdAt");
    await queryInterface.removeColumn("users", "updatedAt");
  },
};
