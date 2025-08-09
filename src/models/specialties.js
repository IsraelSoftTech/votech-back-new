const Sequelize = require('sequelize');
module.exports = function(sequelize, DataTypes) {
  return sequelize.define('specialties', {
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
    abbreviation: {
      type: DataTypes.STRING(20),
      allowNull: true
    }
  }, {
    sequelize,
    tableName: 'specialties',
    schema: 'public',
    timestamps: true,
    indexes: [
      {
        name: "specialties_pkey",
        unique: true,
        fields: [
          { name: "id" },
        ]
      },
    ]
  });
};
