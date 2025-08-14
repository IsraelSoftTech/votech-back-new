"use strict";

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable("classes", {
      id: {
        allowNull: false,
        autoIncrement: true,
        primaryKey: true,
        type: Sequelize.INTEGER,
      },
      name: {
        type: Sequelize.STRING(100),
        allowNull: false,
      },
      registration_fee: {
        type: Sequelize.FLOAT,
        allowNull: true,
        defaultValue: 0,
      },
      bus_fee: {
        type: Sequelize.FLOAT,
        allowNull: true,
        defaultValue: 0,
      },
      internship_fee: {
        type: Sequelize.FLOAT,
        allowNull: true,
        defaultValue: 0,
      },
      remedial_fee: {
        type: Sequelize.FLOAT,
        allowNull: true,
        defaultValue: 0,
      },
      tuition_fee: {
        type: Sequelize.FLOAT,
        allowNull: true,
        defaultValue: 0,
      },
      pta_fee: {
        type: Sequelize.FLOAT,
        allowNull: true,
        defaultValue: 0,
      },
      total_fee: {
        type: Sequelize.FLOAT,
        allowNull: true,
        defaultValue: 0,
      },
      suspended: {
        type: Sequelize.BOOLEAN,
        allowNull: true,
        defaultValue: false,
      },
      class_master_id: {
        type: Sequelize.INTEGER,
        allowNull: true,
        references: { model: "users", key: "id" },
        onUpdate: "CASCADE",
        onDelete: "SET NULL",
      },
      department_id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: { model: "specialties", key: "id" },
        onUpdate: "CASCADE",
        onDelete: "RESTRICT",
      },
      createdAt: {
        allowNull: false,
        type: Sequelize.DATE,
      },
      updatedAt: {
        allowNull: false,
        type: Sequelize.DATE,
      },
    });

    // Unique composite index
    await queryInterface.addIndex("classes", ["name", "department_id"], {
      unique: true,
      name: "unique_class_name_per_department",
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable("classes");
  },
};
