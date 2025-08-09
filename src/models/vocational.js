const Sequelize = require("sequelize");
module.exports = function (sequelize, DataTypes) {
  return sequelize.define(
    "vocational",
    {
      id: {
        autoIncrement: true,
        type: DataTypes.INTEGER,
        allowNull: false,
        primaryKey: true,
      },
      user_id: {
        type: DataTypes.INTEGER,
        allowNull: true,
      },
      name: {
        type: DataTypes.STRING(100),
        allowNull: true,
      },
      description: {
        type: DataTypes.TEXT,
        allowNull: true,
      },
      picture1: {
        type: DataTypes.STRING(255),
        allowNull: true,
      },
      picture2: {
        type: DataTypes.STRING(255),
        allowNull: true,
      },
      picture3: {
        type: DataTypes.STRING(255),
        allowNull: true,
      },
      picture4: {
        type: DataTypes.STRING(255),
        allowNull: true,
      },
      year: {
        type: DataTypes.STRING(20),
        allowNull: true,
      },
    },
    {
      sequelize,
      tableName: "vocational",
      schema: "public",
      timestamps: true,
      indexes: [
        {
          name: "vocational_pkey",
          unique: true,
          fields: [{ name: "id" }],
        },
      ],
    }
  );
};
