const Sequelize = require('sequelize');
module.exports = function(sequelize, DataTypes) {
  return sequelize.define('teacher_assignments', {
    id: {
      autoIncrement: true,
      type: DataTypes.INTEGER,
      allowNull: false,
      primaryKey: true
    },
    teacher_id: {
      type: DataTypes.INTEGER,
      allowNull: true,
      references: {
        model: 'users',
        key: 'id'
      },
      unique: "teacher_assignments_teacher_id_class_id_subject_id_key"
    },
    class_id: {
      type: DataTypes.INTEGER,
      allowNull: true,
      references: {
        model: 'classes',
        key: 'id'
      },
      unique: "teacher_assignments_teacher_id_class_id_subject_id_key"
    },
    subject_id: {
      type: DataTypes.INTEGER,
      allowNull: true,
      references: {
        model: 'subjects',
        key: 'id'
      },
      unique: "teacher_assignments_teacher_id_class_id_subject_id_key"
    },
    periods_per_week: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 1
    }
  }, {
    sequelize,
    tableName: 'teacher_assignments',
    schema: 'public',
    timestamps: true,
    indexes: [
      {
        name: "teacher_assignments_pkey",
        unique: true,
        fields: [
          { name: "id" },
        ]
      },
      {
        name: "teacher_assignments_teacher_id_class_id_subject_id_key",
        unique: true,
        fields: [
          { name: "teacher_id" },
          { name: "class_id" },
          { name: "subject_id" },
        ]
      },
    ]
  });
};
