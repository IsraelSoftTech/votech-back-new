const express = require("express");
const { Sequelize } = require("sequelize");

const app = express();

// DB connection
const sequelize = new Sequelize(
  "votech_db",
  "votech_db_user",
  "votech_db_2025",
  {
    host: "31.97.113.198",
    dialect: "postgres",
  }
);

// Test connection
sequelize
  .authenticate()
  .then(() => console.log("✅ DB connected"))
  .catch((err) => console.error("❌ DB connection error:", err));

app.listen(3000, () => console.log("🚀 Server running on port 3000"));
