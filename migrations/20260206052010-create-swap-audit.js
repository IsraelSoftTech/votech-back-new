"use strict";

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable("swap_audit", {
      id: {
        type: Sequelize.INTEGER,
        primaryKey: true,
        autoIncrement: true,
        allowNull: false,
      },

      operation_id: {
        type: Sequelize.UUID,
        allowNull: false,
      },

      direction: {
        type: Sequelize.STRING(20),
        allowNull: false,
      },

      target_mode: {
        type: Sequelize.STRING(10),
        allowNull: false,
      },

      initiated_from: {
        type: Sequelize.STRING(255),
        allowNull: true,
        comment: "Machine name",
      },

      started_at: {
        type: Sequelize.DATE,
        allowNull: false,
      },

      completed_at: {
        type: Sequelize.DATE,
        allowNull: true,
      },

      duration_seconds: {
        type: Sequelize.INTEGER,
        allowNull: true,
      },

      status: {
        type: Sequelize.STRING(30),
        allowNull: false,
      },

      warnings: {
        type: Sequelize.JSONB,
        allowNull: true,
      },

      error_message: {
        type: Sequelize.TEXT,
        allowNull: true,
      },

      source_dump_checksum: {
        type: Sequelize.STRING(64),
        allowNull: true,
      },

      target_dump_checksum: {
        type: Sequelize.STRING(64),
        allowNull: true,
      },

      source_row_counts: {
        type: Sequelize.JSONB,
        allowNull: true,
      },

      restored_row_counts: {
        type: Sequelize.JSONB,
        allowNull: true,
      },

      created_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.fn("NOW"),
      },
    });

    // Indexes
    await queryInterface.addIndex("swap_audit", ["operation_id"], {
      name: "idx_swap_audit_operation",
    });

    await queryInterface.addIndex("swap_audit", ["started_at"], {
      name: "idx_swap_audit_started",
    });
  },

  async down(queryInterface) {
    await queryInterface.dropTable("swap_audit");
  },
};
