"use strict";

module.exports = {
  async up(queryInterface, Sequelize) {
    // Drop the table if it exists
    await queryInterface.dropTable("marks");

    // Create the new table
    await queryInterface.createTable("marks", {
      id: {
        type: Sequelize.INTEGER,
        primaryKey: true,
        autoIncrement: true,
        allowNull: false,
      },
      student_id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: {
          model: "students",
          key: "id",
        },
        onDelete: "CASCADE",
      },
      subject_id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: {
          model: "subjects",
          key: "id",
        },
        onDelete: "CASCADE",
      },
      class_id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: {
          model: "classes",
          key: "id",
        },
        onDelete: "CASCADE",
      },
      academic_year_id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: {
          model: "academicYears",
          key: "id",
        },
        onDelete: "CASCADE",
      },
      term_id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: {
          model: "terms",
          key: "id",
        },
        onDelete: "CASCADE",
      },
      sequence_id: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: {
          model: "sequences",
          key: "id",
        },
        onDelete: "CASCADE",
      },
      score: {
        type: Sequelize.DECIMAL(5, 2),
        allowNull: false,
      },
      uploaded_by: {
        type: Sequelize.INTEGER,
        allowNull: false,
        references: {
          model: "users",
          key: "id",
        },
        onDelete: "CASCADE",
      },
      uploaded_at: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.fn("NOW"),
      },
      createdAt: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.fn("NOW"),
      },
      updatedAt: {
        type: Sequelize.DATE,
        allowNull: false,
        defaultValue: Sequelize.fn("NOW"),
      },
      deletedAt: {
        type: Sequelize.DATE,
        allowNull: true,
      },
    });

    // Add composite unique constraint
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

    // Add indexes for faster lookups
    await queryInterface.addIndex("marks", ["student_id"]);
    await queryInterface.addIndex("marks", ["subject_id"]);
    await queryInterface.addIndex("marks", ["class_id"]);
    await queryInterface.addIndex("marks", ["academic_year_id"]);
    await queryInterface.addIndex("marks", ["term_id"]);
    await queryInterface.addIndex("marks", ["sequence_id"]);
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.dropTable("marks");
  },
};
