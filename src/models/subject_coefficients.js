const Sequelize = require('sequelize');
module.exports = function(sequelize, DataTypes) {
  return sequelize.define('subject_coefficients', {
    id: {
      autoIncrement: true,
      type: DataTypes.INTEGER,
      allowNull: false,
      primaryKey: true
    },
    class_id: {
      type: DataTypes.INTEGER,
      allowNull: true,
      references: {
        model: 'classes',
        key: 'id'
      },
      unique: "subject_coefficients_class_id_subject_id_key"
    },
    subject_id: {
      type: DataTypes.INTEGER,
      allowNull: true,
      references: {
        model: 'subjects',
        key: 'id'
      },
      unique: "subject_coefficients_class_id_subject_id_key"
    },
    coefficient: {
      type: DataTypes.DECIMAL,
      allowNull: false,
      defaultValue: 1.00
    }
  }, {
    sequelize,
    tableName: 'subject_coefficients',
    schema: 'public',
    timestamps: true,
    indexes: [
      {
        name: "subject_coefficients_class_id_subject_id_key",
        unique: true,
        fields: [
          { name: "class_id" },
          { name: "subject_id" },
        ]
      },
      {
        name: "subject_coefficients_pkey",
        unique: true,
        fields: [
          { name: "id" },
        ]
      },
    ]
  });
};
