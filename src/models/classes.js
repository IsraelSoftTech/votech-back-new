const Sequelize = require('sequelize');
module.exports = function(sequelize, DataTypes) {
  return sequelize.define('classes', {
    id: {
      autoIncrement: true,
      type: DataTypes.INTEGER,
      allowNull: false,
      primaryKey: true
    },
    name: {
      type: DataTypes.STRING(100),
      allowNull: false
    },
    registration_fee: {
      type: DataTypes.STRING(50),
      allowNull: true
    },
    bus_fee: {
      type: DataTypes.STRING(50),
      allowNull: true
    },
    internship_fee: {
      type: DataTypes.STRING(50),
      allowNull: true
    },
    remedial_fee: {
      type: DataTypes.STRING(50),
      allowNull: true
    },
    tuition_fee: {
      type: DataTypes.STRING(50),
      allowNull: true
    },
    pta_fee: {
      type: DataTypes.STRING(50),
      allowNull: true
    },
    total_fee: {
      type: DataTypes.STRING(50),
      allowNull: true
    },
    suspended: {
      type: DataTypes.BOOLEAN,
      allowNull: true,
      defaultValue: false
    }
  }, {
    sequelize,
    tableName: 'classes',
    schema: 'public',
    timestamps: true,
    indexes: [
      {
        name: "classes_pkey",
        unique: true,
        fields: [
          { name: "id" },
        ]
      },
    ]
  });
};
