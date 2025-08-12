"use strict";

module.exports = {
  up: async (queryInterface, Sequelize) => {
    await queryInterface.removeConstraint("terms", "terms_name_key");

    await queryInterface.addIndex("terms", ["academic_year_id", "name"], {
      unique: true,
      name: "terms_academic_year_id_name_key",
    });
  },

  down: async (queryInterface, Sequelize) => {
    await queryInterface.removeIndex(
      "terms",
      "terms_academic_year_id_name_key"
    );

    await queryInterface.addIndex("terms", ["name"], {
      unique: true,
      name: "terms_name_key",
    });
  },
};
