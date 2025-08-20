"use strict";
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable("academicYears", {
      id: { type: Sequelize.INTEGER, autoIncrement: true, primaryKey: true },
      name: { type: Sequelize.STRING, allowNull: false, unique: true },
      start_date: { type: Sequelize.DATEONLY, allowNull: false },
      end_date: { type: Sequelize.DATEONLY, allowNull: false },
      status: { type: Sequelize.ENUM("active", "archived"), allowNull: false },
      createdAt: { type: Sequelize.DATE, allowNull: false },
      updatedAt: { type: Sequelize.DATE, allowNull: false },
      deletedAt: { type: Sequelize.DATE }, // for paranoid
    });
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.dropTable("academicYears");
  },
};
