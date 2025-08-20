"use strict";

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable("subjects", {
      id: {
        type: Sequelize.INTEGER,
        primaryKey: true,
        autoIncrement: true,
        allowNull: false,
      },
      name: {
        type: Sequelize.STRING(100),
        allowNull: false,
      },
      code: {
        type: Sequelize.STRING(20),
        allowNull: true,
        unique: true,
      },
      coefficient: {
        type: Sequelize.INTEGER,
        allowNull: false,
        defaultValue: 1,
      },
      category: {
        type: Sequelize.ENUM("general", "professional"),
        allowNull: false,
      },
      createdAt: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal("NOW()"),
      },
      updatedAt: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal("NOW()"),
      },
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable("subjects");
    await queryInterface.sequelize.query(
      'DROP TYPE IF EXISTS "enum_subjects_category";'
    );
  },
};
