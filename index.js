process.on("uncaughtException", (err) => {
  console.error("Uncaught Exception:", err);
});
process.on("unhandledRejection", (reason) => {
  console.error("Unhandled Rejection:", reason);
});

require("dotenv").config();
const { pool } = require("./routes/utils");
const { createServer } = require("http");
const { initSockets } = require("./src/desktop-module/socket/index");
const app = require("./app");

const basePort = parseInt(process.env.PORT || "5000", 10);
const { exec } = require("child_process");

async function runMigrations() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS report_inventory (
        id SERIAL PRIMARY KEY,
        item_name VARCHAR(255) NOT NULL,
        description TEXT,
        category VARCHAR(20) NOT NULL CHECK (category IN ('income', 'expenditure')),
        uom VARCHAR(50) NOT NULL CHECK (uom IN ('Pieces', 'Kg', 'Liters', 'Cartons')),
        quantity INTEGER NOT NULL DEFAULT 1,
        unit_cost_price NUMERIC(12,2) NOT NULL,
        depreciation_rate NUMERIC(5,2),
        supplier VARCHAR(255),
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `);
    await pool.query(`
      ALTER TABLE report_inventory ADD COLUMN IF NOT EXISTS quantity INTEGER NOT NULL DEFAULT 1
    `);
    await pool.query(`
      CREATE TABLE IF NOT EXISTS report_inventory_heads (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `);
    await pool.query(`
      ALTER TABLE report_inventory ADD COLUMN IF NOT EXISTS head_id INTEGER REFERENCES report_inventory_heads(id) ON DELETE SET NULL
    `);
    await pool.query(`
      ALTER TABLE report_inventory ADD COLUMN IF NOT EXISTS support_doc VARCHAR(100)
    `);
    await pool.query(`
      ALTER TABLE report_inventory ADD COLUMN IF NOT EXISTS item_id VARCHAR(20) UNIQUE
    `);
    await pool
      .query(
        `
      ALTER TABLE report_inventory ALTER COLUMN quantity DROP NOT NULL
    `
      )
      .catch(() => {});
    await pool
      .query(
        `
      ALTER TABLE report_inventory DROP CONSTRAINT IF EXISTS report_inventory_uom_check
    `
      )
      .catch(() => {});
    await pool
      .query(
        `
      ALTER TABLE report_inventory DROP CONSTRAINT IF EXISTS report_inventory_uom_check
    `
      )
      .catch(() => {});
    await pool
      .query(
        `
      ALTER TABLE report_inventory ADD CONSTRAINT report_inventory_uom_check
      CHECK (uom IN ('Pieces', 'Kg', 'Liters', 'Cartons', 'Others'))
    `
      )
      .catch(() => {});
    await pool
      .query(
        `
      ALTER TABLE report_inventory ADD COLUMN IF NOT EXISTS amount NUMERIC(12,2)
    `
      )
      .catch(() => {});
    await pool
      .query(
        `
      UPDATE report_inventory SET amount = unit_cost_price * COALESCE(quantity, 1) WHERE amount IS NULL
    `
      )
      .catch(() => {});
    const { rows: needBackfill } = await pool.query(
      "SELECT id, item_name FROM report_inventory WHERE item_id IS NULL ORDER BY id"
    );
    for (const row of needBackfill) {
      const prefix =
        (row.item_name || "XX")
          .slice(0, 2)
          .toUpperCase()
          .replace(/[^A-Z]/g, "X") || "XX";
      const { rows: existing } = await pool.query(
        "SELECT item_id FROM report_inventory WHERE item_id LIKE $1 ORDER BY item_id DESC LIMIT 1",
        [prefix + "%"]
      );
      let nextNum = 1;
      if (existing.length) {
        const m = existing[0].item_id?.match(/(\d+)$/);
        if (m) nextNum = parseInt(m[1], 10) + 1;
      }
      const itemId = prefix + String(nextNum).padStart(3, "0");
      await pool.query(
        "UPDATE report_inventory SET item_id = $1 WHERE id = $2",
        [itemId, row.id]
      );
    }
    console.log("✅ report_inventory table ready");
  } catch (err) {
    console.warn("⚠️ Migration (report_inventory):", err.message);
  }

  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS property_equipment (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        cost NUMERIC(12,2) NOT NULL,
        department_location VARCHAR(50) NOT NULL,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `);
    await pool
      .query(
        `
      ALTER TABLE property_equipment DROP CONSTRAINT IF EXISTS property_equipment_department_location_check
    `
      )
      .catch(() => {});
    await pool
      .query(
        `
      ALTER TABLE property_equipment ALTER COLUMN department_location TYPE VARCHAR(50)
    `
      )
      .catch(() => {});
    console.log("✅ property_equipment table ready");
  } catch (err) {
    console.warn("⚠️ Migration (property_equipment):", err.message);
  }
}

function killPort(port) {
  return new Promise((resolve) => {
    const cmd =
      process.platform === "win32"
        ? `for /f "tokens=5" %a in ('netstat -ano ^| findstr :${port} ^| findstr LISTENING') do taskkill /F /PID %a`
        : `lsof -ti tcp:${port} | xargs kill -9`;
    exec(cmd, (err) => {
      if (err) console.warn(`Port ${port} cleanup warning:`, err.message);
      else console.log(`Cleaned any processes on port ${port}`);
      resolve();
    });
  });
}

async function startOnce(port) {
  await runMigrations();
  await killPort(port);

  const server = createServer(app);
  initSockets(server);

  server.listen(port, "0.0.0.0", () => {
    console.log(`Server running on port ${port}`);
  });
  server.on("error", (err) => {
    if (err && err.code === "EADDRINUSE") {
      console.error(`Failed to bind to port ${port}: address in use`);
    } else {
      console.error("Failed to start server:", err);
    }
    process.exit(1);
  });
}

startOnce(basePort).catch((err) => {
  console.error("Failed to start server:", err);
  process.exit(1);
});

console.log("🚀 Starting Votech Backend Server...");
console.log("📊 Database: PostgreSQL");
console.log("🔐 Authentication: JWT");
console.log("📁 File Storage: FTP + Local");
