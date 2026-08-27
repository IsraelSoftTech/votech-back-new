"use strict";
const { Model, DataTypes } = require("sequelize");

// Year-scoped replacement for the "who is class master" question.
// classes.class_master_id still exists as a denormalized "current value"
// convenience field (kept in sync whenever the active year's assignment
// changes), but this table is authoritative for anything that needs to
// know who the class master was in a SPECIFIC year, report cards and
// transcripts read this, never the live field on classes.
module.exports = (sequelize) => {
  class ClassMasterAssignment extends Model {
    static associate(models) {
      ClassMasterAssignment.belongsTo(models.Class, {
        foreignKey: "class_id",
        as: "class",
      });
      ClassMasterAssignment.belongsTo(models.User, {
        foreignKey: "teacher_id",
        as: "teacher",
      });
      ClassMasterAssignment.belongsTo(models.AcademicYear, {
        foreignKey: "academic_year_id",
        as: "academic_year",
      });
    }
  }

  ClassMasterAssignment.init(
    {
      academic_year_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },
      class_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },
      teacher_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },
    },
    {
      sequelize,
      modelName: "ClassMasterAssignment",
      tableName: "class_master_assignments",
      timestamps: true,
      createdAt: "created_at",
      updatedAt: "updated_at",
      indexes: [
        {
          unique: true,
          fields: ["academic_year_id", "class_id"],
          name: "unique_class_master_year",
        },
      ],
    }
  );

  return ClassMasterAssignment;
};
