"use strict";

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn("students", "academic_year_id", {
      type: Sequelize.INTEGER,
      allowNull: false, // set to false if it should be mandatory
      references: {
        model: "academicYears", // make sure this matches your table name
        key: "id",
      },
      onUpdate: "CASCADE",
      onDelete: "SET NULL",
    });
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.removeColumn("students", "academic_year_id");
  },
};
