"use strict";
const { Model } = require("sequelize");

module.exports = (sequelize, DataTypes) => {
  class ClassSubject extends Model {
    static associate(models) {
      // Class association
      ClassSubject.belongsTo(models.Class, {
        foreignKey: "class_id",
        as: "class",
      });
      ClassSubject.belongsTo(models.Subject, {
        foreignKey: "subject_id",
        as: "subject",
      });
      ClassSubject.belongsTo(models.users, {
        foreignKey: "teacher_id",
        as: "teacher",
      });
      ClassSubject.belongsTo(models.specialties, {
        foreignKey: "department_id",
        as: "department",
      });
    }
  }

  ClassSubject.init(
    {
      class_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },
      subject_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },
      teacher_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },
      department_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
      },
    },
    {
      sequelize,
      modelName: "ClassSubject",
      tableName: "class_subjects",
      indexes: [
        {
          unique: true,
          fields: ["class_id", "subject_id", "department_id"],
          name: "unique_class_subject_department",
        },
      ],
      validate: {
        async oneTeacherPerClassSubjectDepartment() {
          const exists = await ClassSubject.findOne({
            where: {
              class_id: this.class_id,
              subject_id: this.subject_id,
              department_id: this.department_id,
            },
          });

          if (exists && exists.teacher_id !== this.teacher_id) {
            throw new Error(
              "Only one teacher can be assigned to the same class, subject, and department."
            );
          }
        },
      },
    }
  );

  return ClassSubject;
};
