const db =
  process.env.NODE_ENV === "desktop"
    ? process.env.DATABASE_URL_LOCAL
    : process.env.DATABASE_URL;

const { Sequelize, DataTypes } = require("sequelize");
const sequelize = new Sequelize(db, {
  logging: false,
});

module.exports = { sequelize, DataTypes };
