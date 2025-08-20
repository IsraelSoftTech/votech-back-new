"use strict";

/** @type {import('sequelize-cli').Migration} */
module.exports = {
  async up(queryInterface, Sequelize) {
    await queryInterface.addColumn("class_subjects", "department_id", {
      type: Sequelize.INTEGER,
      allowNull: false,
      references: {
        model: "specialties", // table name
        key: "id",
      },
      onUpdate: "CASCADE",
      onDelete: "CASCADE",
    });

    // Add unique constraint to prevent duplicates
    await queryInterface.addConstraint("class_subjects", {
      fields: ["class_id", "subject_id", "department_id"],
      type: "unique",
      name: "unique_class_subject_department",
    });
  },

  async down(queryInterface, Sequelize) {
    await queryInterface.removeConstraint(
      "class_subjects",
      "unique_class_subject_department"
    );

    await queryInterface.removeColumn("class_subjects", "department_id");
  },
};
