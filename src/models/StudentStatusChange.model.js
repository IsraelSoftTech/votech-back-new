"use strict";
const { Model } = require("sequelize");

// One row every time a student is marked graduated or as having left the
// school (or that marking is reverted), outside of a promotion run. The
// promotion tables already record graduation that happens as part of a
// run (PromotionRunMove.is_graduation); this covers the registration-desk
// case where a student is exited one by one or in bulk after a year
// switch, so a student's history never has a silent status jump.
module.exports = (sequelize, DataTypes) => {
  class StudentStatusChange extends Model {
    static associate(models) {
      StudentStatusChange.belongsTo(models.Student, {
        foreignKey: "student_id",
        as: "student",
      });
      StudentStatusChange.belongsTo(models.Class, {
        foreignKey: "class_id",
        as: "class",
      });
      StudentStatusChange.belongsTo(models.AcademicYear, {
        foreignKey: "academic_year_id",
        as: "academic_year",
      });
      StudentStatusChange.belongsTo(models.User, {
        foreignKey: "performed_by",
        as: "performer",
      });
      StudentStatusChange.belongsTo(models.User, {
        foreignKey: "reverted_by",
        as: "reverter",
      });
    }
  }

  StudentStatusChange.init(
    {
      id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
      student_id: { type: DataTypes.INTEGER, allowNull: false },
      from_status: { type: DataTypes.STRING(20), allowNull: false },
      to_status: {
        type: DataTypes.STRING(20),
        allowNull: false,
        validate: { isIn: { args: [["graduated", "withdrawn", "active"]], msg: "Invalid status" } },
      },
      // Where the student was when the change happened, kept even if the
      // student row itself moves on later.
      academic_year_id: { type: DataTypes.INTEGER, allowNull: true },
      class_id: { type: DataTypes.INTEGER, allowNull: true },
      reason: { type: DataTypes.TEXT, allowNull: true },
      effective_date: { type: DataTypes.DATEONLY, allowNull: true },
      // "single" from a student's own page/row, "bulk" from a class page or
      // the pending-placement sweep, so the audit trail says how it happened.
      source: {
        type: DataTypes.STRING(20),
        allowNull: false,
        defaultValue: "single",
        validate: { isIn: { args: [["single", "bulk"]], msg: "Invalid source" } },
      },
      performed_by: { type: DataTypes.INTEGER, allowNull: false },
      performed_at: { type: DataTypes.DATE, allowNull: false, defaultValue: DataTypes.NOW },
      reverted_at: { type: DataTypes.DATE, allowNull: true },
      reverted_by: { type: DataTypes.INTEGER, allowNull: true },
    },
    {
      sequelize,
      modelName: "StudentStatusChange",
      tableName: "student_status_changes",
      freezeTableName: true,
      timestamps: true,
      createdAt: "created_at",
      updatedAt: "updated_at",
      indexes: [{ fields: ["student_id"] }, { fields: ["performed_at"] }],
    }
  );

  return StudentStatusChange;
};
