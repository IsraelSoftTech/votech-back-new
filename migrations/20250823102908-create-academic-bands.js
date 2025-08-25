"use strict";

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.changeColumn("academic_bands", "band_min", {
      type: Sequelize.DOUBLE,
      allowNull: false,
    });

    await queryInterface.changeColumn("academic_bands", "band_max", {
      type: Sequelize.DOUBLE,
      allowNull: false,
    });
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.changeColumn("academic_bands", "band_min", {
      type: Sequelize.INTEGER,
      allowNull: false,
    });

    await queryInterface.changeColumn("academic_bands", "band_max", {
      type: Sequelize.INTEGER,
      allowNull: false,
    });
  },
};
