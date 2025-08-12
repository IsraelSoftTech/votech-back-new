"use strict";

module.exports = {
  up: async (queryInterface, Sequelize) => {
    const table = "subjects";

    // Check if column exists helper
    async function addColumnIfNotExists(columnName, columnOptions) {
      const tableDesc = await queryInterface.describeTable(table);
      if (!tableDesc[columnName]) {
        await queryInterface.addColumn(table, columnName, columnOptions);
      }
    }

    await addColumnIfNotExists("id", {
      type: Sequelize.INTEGER,
      primaryKey: true,
      autoIncrement: true,
      allowNull: false,
    });

    await addColumnIfNotExists("name", {
      type: Sequelize.STRING,
      allowNull: false,
    });

    await addColumnIfNotExists("code", {
      type: Sequelize.STRING,
      allowNull: true,
    });

    await addColumnIfNotExists("coefficient", {
      type: Sequelize.FLOAT,
      allowNull: true,
    });

    await addColumnIfNotExists("category", {
      type: Sequelize.STRING,
      allowNull: true,
    });

    await addColumnIfNotExists("createdAt", {
      type: Sequelize.DATE,
      allowNull: false,
      defaultValue: Sequelize.fn("NOW"),
    });

    await addColumnIfNotExists("updatedAt", {
      type: Sequelize.DATE,
      allowNull: false,
      defaultValue: Sequelize.fn("NOW"),
    });

    // If you're using paranoid (soft deletes)
    await addColumnIfNotExists("deletedAt", {
      type: Sequelize.DATE,
      allowNull: true,
    });
  },

  down: async (queryInterface, Sequelize) => {
    const table = "subjects";
    await queryInterface.removeColumn(table, "coefficient");
    await queryInterface.removeColumn(table, "deletedAt");
    // Usually, you don't remove PKs or timestamp columns on rollback
  },
};
