const Sequelize = require('sequelize');
module.exports = function(sequelize, DataTypes) {
  return sequelize.define('salaries', {
    id: {
      autoIncrement: true,
      type: DataTypes.INTEGER,
      allowNull: false,
      primaryKey: true
    },
    amount: {
      type: DataTypes.DECIMAL,
      allowNull: false
    },
    month: {
      type: DataTypes.STRING(20),
      allowNull: false,
      unique: "salaries_user_id_month_year_key"
    },
    paid: {
      type: DataTypes.BOOLEAN,
      allowNull: true,
      defaultValue: false
    },
    paid_at: {
      type: DataTypes.DATE,
      allowNull: true
    },
    user_id: {
      type: DataTypes.INTEGER,
      allowNull: true,
      references: {
        model: 'users',
        key: 'id'
      },
      unique: "salaries_user_id_month_year_key"
    },
    year: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: EXTRACT(year FROM CURRENT_DATE),
      unique: "salaries_user_id_month_year_key"
    },
    status: {
      type: DataTypes.STRING(20),
      allowNull: true,
      defaultValue: "pending"
    },
    
  }, {
    sequelize,
    tableName: 'salaries',
    schema: 'public',
    timestamps: true,
    indexes: [
      {
        name: "salaries_pkey",
        unique: true,
        fields: [
          { name: "id" },
        ]
      },
      {
        name: "salaries_user_id_month_key",
        unique: true,
        fields: [
          { name: "user_id" },
          { name: "month" },
        ]
      },
      {
        name: "salaries_user_id_month_year_key",
        unique: true,
        fields: [
          { name: "user_id" },
          { name: "month" },
          { name: "year" },
        ]
      },
    ]
  });
};
