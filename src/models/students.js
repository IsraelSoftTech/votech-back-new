const Sequelize = require('sequelize');
module.exports = function(sequelize, DataTypes) {
  return sequelize.define('students', {
    id: {
      autoIncrement: true,
      type: DataTypes.INTEGER,
      allowNull: false,
      primaryKey: true
    },
    student_id: {
      type: DataTypes.STRING(32),
      allowNull: false,
      unique: "students_student_id_key"
    },
    registration_date: {
      type: DataTypes.DATEONLY,
      allowNull: false
    },
    full_name: {
      type: DataTypes.STRING(100),
      allowNull: false
    },
    sex: {
      type: DataTypes.STRING(10),
      allowNull: false
    },
    date_of_birth: {
      type: DataTypes.DATEONLY,
      allowNull: false
    },
    place_of_birth: {
      type: DataTypes.STRING(100),
      allowNull: false
    },
    father_name: {
      type: DataTypes.STRING(100),
      allowNull: true
    },
    mother_name: {
      type: DataTypes.STRING(100),
      allowNull: true
    },
    class_id: {
      type: DataTypes.INTEGER,
      allowNull: true,
      references: {
        model: 'classes',
        key: 'id'
      }
    },
    specialty_id: {
      type: DataTypes.INTEGER,
      allowNull: true,
      references: {
        model: 'specialties',
        key: 'id'
      }
    },
    guardian_contact: {
      type: DataTypes.STRING(50),
      allowNull: true
    },
    photo_url: {
      type: DataTypes.STRING(255),
      allowNull: true
    }
  }, {
    sequelize,
    tableName: 'students',
    schema: 'public',
    timestamps: true,
    indexes: [
      {
        name: "students_pkey",
        unique: true,
        fields: [
          { name: "id" },
        ]
      },
      {
        name: "students_student_id_key",
        unique: true,
        fields: [
          { name: "student_id" },
        ]
      },
    ]
  });
};
