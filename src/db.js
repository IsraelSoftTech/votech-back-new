const db =
  process.env.NODE_ENV === "desktop"
    ? process.env.DATABASE_URL_LOCAL
    : process.env.DATABASE_URL;

console.log(process.env.NODE_ENV);

const { Sequelize, DataTypes } = require("sequelize");
const models = require("./models/index.model");
const sequelize = new Sequelize(db, {
  logging: false,
});

sequelize
  .authenticate()
  .then(() => {
    console.log("✅ Database connection successful");
    console.log("📌 NODE_ENV:", process.env.NODE_ENV);
    console.log("📌 Connected DB URL:", db);
  })
  .catch((err) => console.error("❌ Database connection failed:", err));

module.exports = { sequelize, DataTypes };
