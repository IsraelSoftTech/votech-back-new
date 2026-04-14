const Sequelize = require("sequelize");

module.exports = function (sequelize, DataTypes) {
  const specialties = sequelize.define(
    "specialties",
    {
      id: {
        autoIncrement: true,
        type: Sequelize.DataTypes.INTEGER,
        allowNull: false,
        primaryKey: true,
      },
      name: {
        type: Sequelize.DataTypes.STRING(100),
        allowNull: false,
      },
      abbreviation: {
        type: Sequelize.DataTypes.STRING(20),
        allowNull: true,
      },
    },
    {
      sequelize,
      tableName: "specialties",
      schema: "public",
      timestamps: true,
      indexes: [
        {
          name: "specialties_pkey",
          unique: true,
          fields: [{ name: "id" }],
        },
      ],
    }
  );

  specialties.associate = function (models) {
    specialties.belongsToMany(models.Class, {
      through: models.SpecialtyClass,
      foreignKey: "specialty_id",
      otherKey: "class_id",
      as: "classes",
    });
  };

  return specialties;
};
