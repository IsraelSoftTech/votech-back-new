require("dotenv").config();
const { Sequelize, DataTypes } = require("sequelize");

// Determine which database to use based on NODE_ENV
const isDesktop = process.env.NODE_ENV === "desktop";
const dbUrl = isDesktop
  ? process.env.DATABASE_URL_LOCAL
  : process.env.DATABASE_URL;

console.log("\n" + "=".repeat(60));
console.log("🔧 Database Configuration");
console.log("=".repeat(60));
console.log("📌 NODE_ENV:", process.env.NODE_ENV || "undefined");
console.log(
  "📌 Environment:",
  isDesktop ? "DESKTOP (Local)" : "PRODUCTION (Remote)"
);
console.log(
  "📌 Database URL:",
  dbUrl ? dbUrl.replace(/:[^:@]+@/, ":****@") : "UNDEFINED"
);
console.log("=".repeat(60) + "\n");

// Validate database URL
if (!dbUrl) {
  console.error("❌ ERROR: Database URL is not defined!");
  console.error(
    "💡 Expected environment variable:",
    isDesktop ? "DATABASE_URL_LOCAL" : "DATABASE_URL"
  );
  console.error("💡 Current NODE_ENV:", process.env.NODE_ENV);
  console.error("\n🔍 Available DATABASE_* variables:");
  Object.keys(process.env)
    .filter((key) => key.startsWith("DATABASE_") || key.startsWith("DB_"))
    .forEach((key) => {
      const value = process.env[key];
      const display =
        value && value.includes("@")
          ? value.replace(/:[^:@]+@/, ":****@")
          : value || "(empty)";
      console.error(`   ${key}=${display}`);
    });
  process.exit(1);
}

// Create Sequelize instance
const sequelize = new Sequelize(dbUrl, {
  logging: process.env.NODE_ENV === "production" ? false : console.log,
  dialect: "postgres",
  pool: {
    max: 5,
    min: 0,
    acquire: 30000,
    idle: 10000,
  },
  dialectOptions: isDesktop
    ? {}
    : {
        // Production settings
        connectTimeout: 60000,
      },
});

// Test connection
sequelize
  .authenticate()
  .then(() => {
    console.log("✅ Database connection successful");
    console.log(
      "📊 Connected to:",
      isDesktop ? "Local PostgreSQL" : "Production PostgreSQL"
    );
    return sequelize.query("SELECT version()");
  })
  .then(([results]) => {
    if (results && results[0]) {
      const version = results[0].version;
      const shortVersion = version.split(" ").slice(0, 2).join(" ");
      console.log("🗄️  PostgreSQL version:", shortVersion);
    }
    console.log("=".repeat(60) + "\n");
  })
  .catch((err) => {
    console.error("\n" + "=".repeat(60));
    console.error("❌ Database connection failed!");
    console.error("=".repeat(60));
    console.error("Error:", err.message);
    console.error("\n🔍 Troubleshooting:");
    console.error("1. Check if PostgreSQL is running");
    console.error("2. Verify database credentials in .env");
    console.error("3. Check network connectivity to database host");
    console.error("4. Ensure database exists and user has access");
    console.error("=".repeat(60) + "\n");

    if (process.env.NODE_ENV === "production") {
      process.exit(1);
    }
  });

module.exports = { sequelize, DataTypes };
