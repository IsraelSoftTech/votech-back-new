const Sequelize = require("sequelize");

module.exports = function (sequelize, DataTypes) {
  const SpecialtyClasses = sequelize.define(
    "specialty_classes",
    {
      id: {
        autoIncrement: true,
        type: DataTypes.INTEGER,
        allowNull: false,
        primaryKey: true,
      },
      specialty_id: {
        type: DataTypes.INTEGER,
        allowNull: true,
        references: {
          model: "specialties",
          key: "id",
        },
      },
      class_id: {
        type: DataTypes.INTEGER,
        allowNull: true,
        references: {
          model: "classes",
          key: "id",
        },
      },
    },
    {
      sequelize,
      tableName: "specialty_classes",
      schema: "public",
      timestamps: false,
      indexes: [
        {
          name: "specialty_classes_pkey",
          unique: true,
          fields: [{ name: "id" }],
        },
      ],
    }
  );

  // Associations
  SpecialtyClasses.associate = function (models) {
    SpecialtyClasses.belongsTo(models.Class, {
      foreignKey: "class_id",
      as: "class",
    });

    SpecialtyClasses.belongsTo(models.specialties, {
      foreignKey: "specialty_id",
      as: "specialty",
    });
  };

  return SpecialtyClasses;
};
