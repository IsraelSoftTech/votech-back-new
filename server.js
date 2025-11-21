process.on("uncaughtException", (err) => {
  console.error("Uncaught Exception:", err);
});
process.on("unhandledRejection", (reason) => {
  console.error("Unhandled Rejection:", reason);
});

require("dotenv").config();
// require("dotenv").config({ path: path.resolve(__dirname, ".env") });
const app = require("./app");
const { sequelize, DataTypes } = require("./src/db");

const basePort = process.env.PORT || "5000";

// Start server function
function startOnce(port) {
  const server = app.listen(port, "0.0.0.0", () => {
    console.log(`🚀 Server running on http://0.0.0.0:${port}`);
    console.log("🚀 Starting Votech Backend Server...");
    console.log("📊 Database: PostgreSQL");
    console.log("🔐 Authentication: JWT");
    console.log("📁 File Storage: FTP + Local");
  });

  const SystemMode = require("./src/models/SystemMode.model")(
    sequelize,
    DataTypes
  );

  const tableName = SystemMode.getTableName();

  async function initSubject() {
    try {
      console.log(tableName);
      const tables = await SystemMode.sequelize
        .getQueryInterface()
        .showAllTables();
      if (!tables.includes(tableName)) {
        await SystemMode.sync({ force: false });
      }
    } catch (err) {
      throw err;
    }
  }

  initSubject().then((data) => {
    (async () => {
      try {
        const count = await SystemMode.count();

        if (count === 0) {
          await SystemMode.create({ mode: "online" });
          console.log('✅ System mode row created with "online"');
        } else if (count === 1) {
          const row = await SystemMode.findOne();
          console.log(`✅ System mode row already present: ${row.mode}`);
        } else {
          throw new Error(
            "❌ Corrupt state: more than one row in system_mode table"
          );
        }
      } catch (e) {
        console.error(
          e.message || "❌ Could not initialise system_mode row:",
          e
        );
        process.exit(1);
      }
    })();
  });

  server.on("error", (err) => {
    if (err.code === "EADDRINUSE") {
      console.error(`Failed to bind to port ${port}: address in use`);
    } else {
      console.error("Failed to start server:", err);
    }
    process.exit(1);
  });
}

// Start server
startOnce(basePort);
