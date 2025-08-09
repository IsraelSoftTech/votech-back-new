const Sequelize = require('sequelize');
module.exports = function(sequelize, DataTypes) {
  return sequelize.define('teachers', {
    id: {
      autoIncrement: true,
      type: DataTypes.INTEGER,
      allowNull: false,
      primaryKey: true
    },
    full_name: {
      type: DataTypes.STRING(100),
      allowNull: false
    },
    sex: {
      type: DataTypes.STRING(10),
      allowNull: false
    },
    id_card: {
      type: DataTypes.STRING(50),
      allowNull: false
    },
    dob: {
      type: DataTypes.DATEONLY,
      allowNull: false
    },
    pob: {
      type: DataTypes.STRING(100),
      allowNull: false
    },
    subjects: {
      type: DataTypes.STRING(255),
      allowNull: false
    },
    classes: {
      type: DataTypes.STRING(255),
      allowNull: true
    },
    contact: {
      type: DataTypes.STRING(50),
      allowNull: false
    },
    status: {
      type: DataTypes.STRING(20),
      allowNull: true,
      defaultValue: "pending"
    },
    user_id: {
      type: DataTypes.INTEGER,
      allowNull: true,
      references: {
        model: 'users',
        key: 'id'
      }
    },
    certificate_url: {
      type: DataTypes.STRING(255),
      allowNull: true
    },
    cv_url: {
      type: DataTypes.STRING(255),
      allowNull: true
    },
    photo_url: {
      type: DataTypes.STRING(255),
      allowNull: true
    }
  }, {
    sequelize,
    tableName: 'teachers',
    schema: 'public',
    timestamps: true,
    indexes: [
      {
        name: "teachers_pkey",
        unique: true,
        fields: [
          { name: "id" },
        ]
      },
    ]
  });
};
