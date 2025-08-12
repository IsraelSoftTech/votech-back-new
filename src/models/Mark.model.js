"use strict";
const { Model, DataTypes } = require("sequelize");

module.exports = (sequelize) => {
  class Mark extends Model {
    static associate(models) {
      Mark.belongsTo(models.students, { foreignKey: "student_id" });
      Mark.belongsTo(models.Subject, { foreignKey: "subject_id" });
      Mark.belongsTo(models.Class, { foreignKey: "class_id" });
      Mark.belongsTo(models.AcademicYear, { foreignKey: "academic_year_id" });
      Mark.belongsTo(models.Sequence, { foreignKey: "sequence_id" });
      Mark.belongsTo(models.users, { foreignKey: "uploaded_by" });
      Mark.belongsTo(models.Term, { foreignKey: "term_id" });
    }
  }
  Mark.init(
    {
      student_id: { type: DataTypes.INTEGER, allowNull: false },
      subject_id: { type: DataTypes.INTEGER, allowNull: false },
      class_id: { type: DataTypes.INTEGER, allowNull: false },
      term_id: { type: DataTypes.INTEGER, allowNull: false },
      academic_year_id: { type: DataTypes.INTEGER, allowNull: false },
      sequence_id: { type: DataTypes.INTEGER, allowNull: false },
      score: { type: DataTypes.DECIMAL(5, 2), allowNull: false },
      uploaded_by: { type: DataTypes.INTEGER, allowNull: false },
      uploaded_at: {
        type: DataTypes.DATE,
        allowNull: false,
        defaultValue: DataTypes.NOW,
      },
    },
    {
      sequelize,
      modelName: "Mark",
      tableName: "marks",
      timestamps: false,
    }
  );
  return Mark;
};
