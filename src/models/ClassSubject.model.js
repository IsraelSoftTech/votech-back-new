"use strict";
const { Model, DataTypes } = require("sequelize");

module.exports = (sequelize) => {
  class ClassSubject extends Model {
    static associate(models) {
      ClassSubject.belongsTo(models.Class, {
        foreignKey: "class_id",
        as: "class",
        onUpdate: "CASCADE",
        onDelete: "SET NULL",
      });
      ClassSubject.belongsTo(models.Subject, {
        foreignKey: "subject_id",
        as: "subject",
        onUpdate: "CASCADE",
        onDelete: "CASCADE",
      });
      ClassSubject.belongsTo(models.users, {
        foreignKey: "teacher_id",
        as: "teacher",
        onUpdate: "CASCADE",
        onDelete: "SET NULL",
      });
    }
  }

  ClassSubject.init(
    {
      class_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        validate: {
          isInt: { msg: "Class ID must be an integer" },
          min: { args: [1], msg: "Class ID must be greater than 0" },
        },
      },
      subject_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        validate: {
          isInt: { msg: "Subject ID must be an integer" },
          min: { args: [1], msg: "Subject ID must be greater than 0" },
        },
      },
      teacher_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        validate: {
          isInt: { msg: "Teacher ID must be an integer" },
          min: { args: [1], msg: "Teacher ID must be greater than 0" },
        },
      },
    },
    {
      sequelize,
      modelName: "ClassSubject",
      tableName: "class_subjects",
      timestamps: true,
      paranoid: true,
      deletedAt: "deleted_at",
      indexes: [
        {
          unique: true,
          fields: ["class_id", "subject_id", "teacher_id"],
        },
      ],
    }
  );

  return ClassSubject;
};
