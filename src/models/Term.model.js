"use strict";
const { Model, DataTypes } = require("sequelize");

module.exports = (sequelize) => {
  class Term extends Model {
    static associate(models) {
      Term.belongsTo(models.AcademicYear, { foreignKey: "academic_year_id" });
    }
  }

  Term.init(
    {
      name: {
        type: DataTypes.STRING,
        allowNull: false,
        unique: true,
        validate: {
          notEmpty: {
            msg: "Term name cannot be empty",
          },
          len: {
            args: [2, 50],
            msg: "Term name must be between 2 and 50 characters",
          },
        },
      },
      order_number: {
        type: DataTypes.INTEGER,
        allowNull: false,
        validate: {
          isInt: {
            msg: "Order number must be an integer",
          },
          min: {
            args: [1],
            msg: "Order number must be at least 1",
          },
        },
      },
      academic_year_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: {
          model: "academicYears",
          key: "id",
        },
        onDelete: "CASCADE",
      },
    },
    {
      sequelize,
      modelName: "Term",
      tableName: "terms",
      freezeTableName: true,
      timestamps: true,
      paranoid: true,
      indexes: [
        {
          unique: true,
          fields: ["academic_year_id", "order_number"],
        },
        {
          unique: true,
          fields: ["academic_year_id", "name"],
        },
      ],
    }
  );

  return Term;
};
