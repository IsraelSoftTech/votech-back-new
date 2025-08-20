"use strict";

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn("classes", "class_master_id", {
      type: Sequelize.INTEGER,
      allowNull: true,
      references: {
        model: "users",
        key: "id",
      },
      onUpdate: "CASCADE",
      onDelete: "SET NULL",
    });

    await queryInterface.addColumn("classes", "department_id", {
      type: Sequelize.INTEGER,
      allowNull: true,
      references: {
        model: "specialties", // table name for your department
        key: "id",
      },
      onUpdate: "CASCADE",
      onDelete: "SET NULL",
    });
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.removeColumn("classes", "class_master_id");
    await queryInterface.removeColumn("classes", "department_id");
  },
};
