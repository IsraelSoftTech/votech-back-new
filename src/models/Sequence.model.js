// models/Sequence.model.js
module.exports = (sequelize, DataTypes) => {
  const Sequence = sequelize.define(
    "Sequence",
    {
      id: {
        type: DataTypes.INTEGER,
        primaryKey: true,
        autoIncrement: true,
      },

      name: {
        type: DataTypes.STRING(50),
        allowNull: false,
        validate: {
          notEmpty: { msg: "Sequence name is required" },
          len: {
            args: [2, 50],
            msg: "Sequence name must be between 2 and 50 characters",
          },
        },
      },

      order_number: {
        type: DataTypes.INTEGER,
        allowNull: false,
        validate: {
          notNull: { msg: "Order number is required" },
          isInt: { msg: "Order number must be an integer" },
          min: {
            args: [1],
            msg: "Order number must be at least 1",
          },
          max: {
            args: [6],
            msg: "Order number cannot be greater than 2 (since there are only 2 sequences per term)",
          },
        },
      },

      term_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: {
          model: "terms",
          key: "id",
        },
        onUpdate: "CASCADE",
        onDelete: "CASCADE",
        validate: {
          notNull: { msg: "Term ID is required" },
          isInt: { msg: "Term ID must be an integer" },
        },
      },
      academic_year_id: {
        type: DataTypes.INTEGER,
        allowNull: false,
        references: {
          model: "academicYears",
          key: "id",
        },
        onUpdate: "CASCADE",
        onDelete: "RESTRICT",
        validate: {
          notNull: { msg: "Academic year ID is required" },
          isInt: { msg: "Academic year ID must be an integer" },
        },
      },
    },
    {
      tableName: "sequences",
      timestamps: true,
      indexes: [
        {
          unique: true,
          fields: ["term_id", "order_number"],
        },
        {
          unique: true,
          fields: ["academic_year_id", "name"],
        },
      ],
    }
  );

  // Associations
  Sequence.associate = (models) => {
    Sequence.belongsTo(models.Term, {
      foreignKey: "term_id",
      as: "term",
    });

    Sequence.belongsTo(models.AcademicYear, {
      foreignKey: "academic_year_id",
      as: "academicYear",
    });
  };

  return Sequence;
};
