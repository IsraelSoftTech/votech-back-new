const Sequelize = require('sequelize');
module.exports = function(sequelize, DataTypes) {
  return sequelize.define('subject_classifications', {
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
      unique: "subject_classifications_class_id_subject_id_key"
    },
    subject_id: {
      type: DataTypes.INTEGER,
      allowNull: true,
      references: {
        model: 'subjects',
        key: 'id'
      },
      unique: "subject_classifications_class_id_subject_id_key"
    },
    classification_type: {
      type: DataTypes.STRING(20),
      allowNull: false
    }
  }, {
    sequelize,
    tableName: 'subject_classifications',
    schema: 'public',
    timestamps: true,
    indexes: [
      {
        name: "subject_classifications_class_id_subject_id_key",
        unique: true,
        fields: [
          { name: "class_id" },
          { name: "subject_id" },
        ]
      },
      {
        name: "subject_classifications_pkey",
        unique: true,
        fields: [
          { name: "id" },
        ]
      },
    ]
  });
};
