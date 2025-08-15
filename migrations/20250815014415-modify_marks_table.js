"use strict";

module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.createTable("marks", {
      id: {
        type: Sequelize.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },
      student_id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: { model: "students", key: "id" },
        onUpdate: "CASCADE",
        onDelete: "CASCADE",
      },
      subject_id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: { model: "subjects", key: "id" },
        onUpdate: "CASCADE",
        onDelete: "CASCADE",
      },
      class_id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: { model: "classes", key: "id" },
        onUpdate: "CASCADE",
        onDelete: "CASCADE",
      },
      academic_year_id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: { model: "academic_years", key: "id" },
        onUpdate: "CASCADE",
        onDelete: "CASCADE",
      },
      term_id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: { model: "terms", key: "id" },
        onUpdate: "CASCADE",
        onDelete: "CASCADE",
      },
      sequence_id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: { model: "sequences", key: "id" },
        onUpdate: "CASCADE",
        onDelete: "CASCADE",
      },
      score: {
        type: Sequelize.DECIMAL(5, 2),
        allowNull: false,
      },
      uploaded_by: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: { model: "users", key: "id" },
        onUpdate: "CASCADE",
        onDelete: "SET NULL",
      },
      uploaded_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal("NOW()"),
      },
      created_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal("NOW()"),
      },
      updated_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.literal("NOW()"),
      },
      deleted_at: {
        type: Sequelize.DATE,
        allowNull: true,
      },
    });

    // Add unique constraint
    await queryInterface.addConstraint("marks", {
      fields: [
        "student_id",
        "subject_id",
        "class_id",
        "academic_year_id",
        "term_id",
        "sequence_id",
      ],
      type: "unique",
      name: "unique_mark_constraint",
    });
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.dropTable("marks");
  },
};
