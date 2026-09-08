require("dotenv").config();
const { Sequelize, DataTypes } = require("sequelize");
const {
  getDatabaseUrl,
  getPoolMax,
  getPoolMin,
  getEnvironmentLabel,
  maskDatabaseUrl,
  useLocalDatabase,
} = require("./config/database");

const { url: dbUrl, local: isLocalDb } = getDatabaseUrl();
const poolMax = getPoolMax();
const poolMin = getPoolMin();

console.log("\n" + "=".repeat(60));
console.log("🔧 Database Configuration");
console.log("=".repeat(60));
console.log("📌 NODE_ENV:", process.env.NODE_ENV || "undefined");
// The label used to just mirror isDesktop (NODE_ENV === "desktop"), so it
// kept printing "PRODUCTION (Remote)" even after pointing DATABASE_URL at
// a local Postgres instance for testing, since NODE_ENV stayed
// "development". Read it off the actual host instead so the label can't
// lie about which database is live.
const isLocalHost = /@(localhost|127\.0\.0\.1)[:/]/.test(dbUrl || "");
console.log(
  "📌 Environment:",
  isLocalHost ? `LOCAL (${isDesktop ? "desktop" : "dev"})` : "REMOTE"
);
console.log(
  "📌 Database URL:",
  dbUrl ? dbUrl.replace(/:[^:@]+@/, ":****@") : "UNDEFINED"
);
console.log("=".repeat(60) + "\n");

if (!dbUrl) {
  console.error("❌ ERROR: Database URL is not defined!");
  console.error(
    "💡 Expected environment variable:",
    isLocalDb ? "DATABASE_URL_LOCAL" : "DATABASE_URL"
  );
  console.error("💡 Current NODE_ENV:", process.env.NODE_ENV);
  console.error(
    "💡 Tip: set NODE_ENV=desktop or USE_LOCAL_DB=1 for local Postgres"
  );
  process.exit(1);
}

const sequelize = new Sequelize(dbUrl, {
  logging: process.env.NODE_ENV === "production" ? false : console.log,
  dialect: "postgres",
  pool: {
    max: poolMax,
    min: poolMin,
    acquire: 60000,
    idle: 10000,
  },
  dialectOptions: isLocalDb ? {} : {},
});

const dbReady = sequelize
  .authenticate()
  .then(() => {
    console.log("✅ Database connection successful");
    console.log(
      "📊 Connected to:",
      isLocalDb ? "Local PostgreSQL" : "Remote PostgreSQL"
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
    if (/too many clients/i.test(err.message)) {
      console.error(
        "5. Remote DB is full — wait 1–2 min without restarting, set DB_POOL_MAX=5, or use NODE_ENV=desktop"
      );
    }
    console.error("=".repeat(60) + "\n");
    throw err;
  });

module.exports = { sequelize, DataTypes, useLocalDatabase, dbReady };
