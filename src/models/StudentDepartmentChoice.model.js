"use strict";
const { Model, DataTypes } = require("sequelize");

// A student's six ranked department preferences, captured at registration
// for orientation-class students (or backfilled later for existing ones).
// This is what promotion's destination-class restriction reads at
// promotion time — lives on the student, not the class, so it survives a
// class's is_orientation flag being toggled later, and is never rebuilt
// or re-derived, only ever written once at registration/backfill and
// read many times after.
module.exports = (sequelize, DataTypes) => {
  class StudentDepartmentChoice extends Model {
    static associate(models) {
      StudentDepartmentChoice.belongsTo(models.Student, {
        foreignKey: "student_id",
        as: "student",
        onDelete: "CASCADE",
      });
      StudentDepartmentChoice.belongsTo(models.Specialty, {
        foreignKey: "department_id",
        as: "department",
      });
    }
  }

  StudentDepartmentChoice.init(
    {
      student_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: { model: "students", key: "id" },
      },
      department_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: { model: "specialties", key: "id" },
      },
      // 1 = top choice ... 6 = last choice.
      rank: {
        type: DataTypes.INTEGER,
        allowNull: false,
        validate: {
          min: { args: [1], msg: "rank must be between 1 and 6" },
          max: { args: [6], msg: "rank must be between 1 and 6" },
        },
      },
    },
    {
      sequelize,
      modelName: "StudentDepartmentChoice",
      tableName: "student_department_choices",
      timestamps: true,
      createdAt: "created_at",
      updatedAt: "updated_at",
      indexes: [
        // A student can't rank two departments the same, and can't use
        // the same rank twice — enforced at the DB level, not just in
        // application code, so a bug or a race between two admins can
        // never actually persist a contradictory set.
        { unique: true, fields: ["student_id", "rank"] },
        { unique: true, fields: ["student_id", "department_id"] },
      ],
    }
  );

  return StudentDepartmentChoice;
};
