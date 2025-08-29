const { Sequelize, DataTypes } = require("sequelize");
const sequelize = new Sequelize(process.env.DATABASE_URL, {
  logging: false
});

module.exports = { sequelize, DataTypes };
