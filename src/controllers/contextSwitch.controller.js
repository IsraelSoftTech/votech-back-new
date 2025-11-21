"use strict";

const { StatusCodes } = require("http-status-codes");
const { body } = require("express-validator");
const { sequelize, DataTypes, Op } = require("../db");
const AppError = require("../utils/AppError");
const catchAsync = require("../utils/catchAsync");
const appResponder = require("../utils/appResponder");
const { ChangeTypes, logChanges } = require("../utils/logChanges.util");
const SystemMode = require("../models/SystemMode.model")(sequelize, DataTypes);
const DbSwapLog = require("../models/dbSwapLog.model")(sequelize, DataTypes);
const { backupAndPushToFTP } = require("../utils/downloadAndBackUpDB");
const { promisify } = require("util");
const exec = promisify(require("child_process").exec);
const { spawn } = require("child_process");
const fs = require("fs").promises;
const fsSync = require("fs");
const path = require("path");
const zlib = require("zlib");
const { v4: uuidv4 } = require("uuid");
const { Client } = require("pg");
const os = require("os");

const TMP_DIR = path.join(__dirname, "../../temp", "db-swaps");
const SWAP_LOCK_FILE = path.join(TMP_DIR, ".swap.lock");
const STATE_FILE = path.join(TMP_DIR, ".swap-state.json");

const IS_WINDOWS = process.platform === "win32";

// PostgreSQL binary paths - CONFIGURE THESE
const PG_BIN_PATH =
  process.env.PG_BIN_PATH ||
  (IS_WINDOWS
    ? "C:\\portable-postgres\\pgsql\\bin" // Your portable postgres path
    : "/usr/bin"); // Default Unix path

// Initialize directories
(async () => {
  try {
    await fs.mkdir(TMP_DIR, { recursive: true });
  } catch (err) {
    console.error("Failed to create temp directory:", err);
  }
})();

// ============================================================
// CROSS-PLATFORM UTILITIES
// ============================================================

function getPgCommand(command) {
  const extension = IS_WINDOWS ? ".exe" : "";
  const pgPath = path.join(PG_BIN_PATH, `${command}${extension}`);

  // Check if exists, otherwise try system PATH
  if (fsSync.existsSync(pgPath)) {
    return `"${pgPath}"`;
  }

  return command; // Hope it's in PATH
}

async function checkDiskSpace(requiredBytes) {
  try {
    if (IS_WINDOWS) {
      // Use PowerShell on Windows
      const drive = path.parse(TMP_DIR).root;
      const { stdout } = await exec(
        `powershell "Get-PSDrive ${drive.charAt(
          0
        )} | Select-Object -ExpandProperty Free"`
      );
      const availableBytes = parseInt(stdout.trim(), 10);

      if (availableBytes < requiredBytes * 2) {
        throw new Error(
          `Insufficient disk space. Required: ${(
            (requiredBytes * 2) /
            1024 /
            1024
          ).toFixed(2)}MB, ` +
            `Available: ${(availableBytes / 1024 / 1024).toFixed(2)}MB`
        );
      }
      return true;
    } else {
      // Use df on Unix
      const { stdout } = await exec(
        `df -k "${TMP_DIR}" | tail -1 | awk '{print $4}'`
      );
      const availableKB = parseInt(stdout.trim(), 10);
      const availableBytes = availableKB * 1024;

      if (availableBytes < requiredBytes * 2) {
        throw new Error(
          `Insufficient disk space. Required: ${(
            (requiredBytes * 2) /
            1024 /
            1024
          ).toFixed(2)}MB, ` +
            `Available: ${(availableBytes / 1024 / 1024).toFixed(2)}MB`
        );
      }
      return true;
    }
  } catch (err) {
    console.warn("Could not verify disk space:", err.message);
    return true; // Don't fail on check errors
  }
}

// ============================================================
// LOCKING MECHANISM
// ============================================================

class SwapLock {
  constructor() {
    this.locked = false;
    this.lockId = null;
  }

  async acquire(maxWaitMs = 5000) {
    const startTime = Date.now();

    while (Date.now() - startTime < maxWaitMs) {
      try {
        const lockId = uuidv4();
        await fs.writeFile(SWAP_LOCK_FILE, lockId, { flag: "wx" });
        this.locked = true;
        this.lockId = lockId;
        return true;
      } catch (err) {
        if (err.code === "EEXIST") {
          try {
            const stats = await fs.stat(SWAP_LOCK_FILE);
            const ageMs = Date.now() - stats.mtimeMs;
            if (ageMs > 3600000) {
              await fs.unlink(SWAP_LOCK_FILE).catch(() => {});
              continue;
            }
          } catch (_) {}
          await new Promise((resolve) => setTimeout(resolve, 100));
        } else {
          throw err;
        }
      }
    }
    throw new Error("Another swap is in progress. Please try again later.");
  }

  async release() {
    if (this.locked && this.lockId) {
      try {
        const content = await fs.readFile(SWAP_LOCK_FILE, "utf8");
        if (content === this.lockId) {
          await fs.unlink(SWAP_LOCK_FILE);
        }
      } catch (_) {}
      this.locked = false;
      this.lockId = null;
    }
  }
}

// ============================================================
// STATE MANAGEMENT
// ============================================================

class SwapState {
  constructor() {
    this.state = {
      phase: "none",
      timestamp: null,
      direction: null,
      backupFiles: [],
      databases: {},
      ftpUploads: {},
    };
  }

  async save() {
    await fs.writeFile(STATE_FILE, JSON.stringify(this.state, null, 2));
  }

  async load() {
    try {
      const content = await fs.readFile(STATE_FILE, "utf8");
      this.state = JSON.parse(content);
      return this.state;
    } catch (_) {
      return null;
    }
  }

  async clear() {
    try {
      await fs.unlink(STATE_FILE);
    } catch (_) {}
    this.state = {
      phase: "none",
      timestamp: null,
      direction: null,
      backupFiles: [],
      databases: {},
      ftpUploads: {},
    };
  }

  update(updates) {
    this.state = {
      ...this.state,
      ...updates,
      timestamp: new Date().toISOString(),
    };
  }
}

// ============================================================
// DATABASE OPERATIONS (Cross-platform)
// ============================================================

async function runCommand(cmd, env = {}, options = {}) {
  try {
    const { stdout, stderr } = await exec(cmd, {
      env: { ...process.env, ...env },
      maxBuffer: 50 * 1024 * 1024,
      timeout: options.timeout || 300000,
      shell: IS_WINDOWS ? "powershell.exe" : undefined,
      ...options,
    });
    return { stdout, stderr, success: true };
  } catch (error) {
    console.error(`Command failed: ${cmd}`);
    console.error(`Error: ${error.message}`);
    throw new Error(`Command failed: ${error.message}`);
  }
}

async function verifyConnection(dbConfig) {
  const client = new Client({
    host: dbConfig.host,
    port: dbConfig.port || 5432,
    user: dbConfig.user,
    database: dbConfig.database,
    password: dbConfig.password || "",
    connectionTimeoutMillis: 5000,
  });

  try {
    await client.connect();
    await client.query("SELECT 1");
    await client.end();
    return true;
  } catch (err) {
    try {
      await client.end();
    } catch (_) {}
    throw new Error(`Database connection failed: ${err.message}`);
  }
}

async function getDatabaseSize(dbConfig) {
  const client = new Client({
    host: dbConfig.host,
    port: dbConfig.port || 5432,
    user: dbConfig.user,
    database: dbConfig.database,
    password: dbConfig.password || "",
  });

  try {
    await client.connect();
    const res = await client.query("SELECT pg_database_size($1) as size", [
      dbConfig.database,
    ]);
    await client.end();
    return parseInt(res.rows[0].size, 10);
  } catch (err) {
    try {
      await client.end();
    } catch (_) {}
    throw new Error(`Failed to get database size: ${err.message}`);
  }
}

// ============================================================
// CROSS-PLATFORM PG_DUMP with Node.js streams
// ============================================================

async function dumpDatabaseToGzip(dbConfig, dstFilename) {
  const outPath = path.join(TMP_DIR, dstFilename);

  return new Promise((resolve, reject) => {
    console.log(`Creating dump: ${dstFilename}`);

    // Build connection string (works on both Windows and Unix)
    const connectionString = `postgresql://${dbConfig.user}:${
      dbConfig.password
    }@${dbConfig.host}:${dbConfig.port || 5432}/${dbConfig.database}`;

    const pgDumpPath = getPgCommand("pg_dump");

    console.log(`Using pg_dump at: ${pgDumpPath}`);

    // Spawn pg_dump process
    const pgDump = spawn(
      pgDumpPath,
      [
        connectionString,
        "--no-password",
        "--format=plain",
        "--no-owner",
        "--no-acl",
        "--clean",
        "--if-exists",
      ],
      {
        env: { ...process.env, PGPASSWORD: dbConfig.password || "" },
        shell: IS_WINDOWS,
      }
    );

    // Create write stream with gzip compression
    const gzip = zlib.createGzip({ level: 9 });
    const writeStream = fsSync.createWriteStream(outPath);

    let hasError = false;
    let errorMessage = "";

    // Pipe: pg_dump -> gzip -> file
    pgDump.stdout.pipe(gzip).pipe(writeStream);

    pgDump.stderr.on("data", (data) => {
      const message = data.toString();
      console.error(`pg_dump stderr: ${message}`);
      errorMessage += message;
    });

    pgDump.on("error", (error) => {
      hasError = true;
      reject(new Error(`Failed to spawn pg_dump: ${error.message}`));
    });

    writeStream.on("finish", async () => {
      if (hasError) return;

      try {
        // Verify dump was created
        const stats = await fs.stat(outPath);
        if (stats.size < 100) {
          reject(new Error("Dump file is too small - may be corrupt"));
          return;
        }

        console.log(
          `✓ Dump created: ${(stats.size / 1024 / 1024).toFixed(2)}MB`
        );
        resolve(outPath);
      } catch (err) {
        reject(new Error(`Failed to verify dump: ${err.message}`));
      }
    });

    writeStream.on("error", (error) => {
      hasError = true;
      reject(new Error(`Write stream error: ${error.message}`));
    });

    gzip.on("error", (error) => {
      hasError = true;
      reject(new Error(`Gzip error: ${error.message}`));
    });

    pgDump.on("close", (code) => {
      if (code !== 0 && !hasError) {
        hasError = true;
        reject(new Error(`pg_dump exited with code ${code}: ${errorMessage}`));
      }
    });
  });
}

// ============================================================
// RESTORE DATABASE (Cross-platform)
// ============================================================

// ============================================================
// RESTORE DATABASE (Cross-platform with version compatibility)
// ============================================================

async function restoreDumpInto(dbConfig, dbName, gzipDumpPath) {
  return new Promise((resolve, reject) => {
    console.log(`Restoring dump into ${dbName}...`);

    const connectionString = `postgresql://${dbConfig.user}:${
      dbConfig.password
    }@${dbConfig.host}:${dbConfig.port || 5432}/${dbName}`;

    const psqlPath = getPgCommand("psql");

    // ✅ Spawn psql process with ON_ERROR_STOP but ignore specific errors
    const psql = spawn(
      psqlPath,
      [
        connectionString,
        "--set",
        "ON_ERROR_STOP=off", // ✅ Changed from "on" to "off"
        "-q",
        "--variable=ON_ERROR_ROLLBACK=on", // ✅ Rollback individual commands that fail
      ],
      {
        env: { ...process.env, PGPASSWORD: dbConfig.password || "" },
        shell: IS_WINDOWS,
      }
    );

    // ✅ Create a transform stream to filter out incompatible commands
    const { Transform } = require("stream");

    const filterStream = new Transform({
      transform(chunk, encoding, callback) {
        let data = chunk.toString();

        // ✅ Filter out incompatible SET commands
        data = data.replace(
          /SET transaction_timeout = .*?;/gi,
          "-- SET transaction_timeout (removed for compatibility)"
        );
        data = data.replace(
          /SET idle_in_transaction_session_timeout = .*?;/gi,
          "-- SET idle_in_transaction_session_timeout (removed)"
        );

        callback(null, data);
      },
    });

    // Create gunzip stream
    const gunzip = zlib.createGunzip();
    const readStream = fsSync.createReadStream(gzipDumpPath);

    let hasError = false;
    let errorMessage = "";
    let stderrOutput = "";

    // Pipe: file -> gunzip -> filter -> psql
    readStream.pipe(gunzip).pipe(filterStream).pipe(psql.stdin);

    psql.stderr.on("data", (data) => {
      const message = data.toString();
      stderrOutput += message;

      // ✅ Only log actual errors, ignore warnings
      if (
        message.includes("ERROR") &&
        !message.includes("transaction_timeout")
      ) {
        console.error(`psql stderr: ${message}`);
        errorMessage += message;
      }
    });

    psql.on("error", (error) => {
      hasError = true;
      reject(new Error(`Failed to spawn psql: ${error.message}`));
    });

    psql.on("close", (code) => {
      // ✅ Check stderr for critical errors instead of just exit code
      const hasCriticalError =
        stderrOutput.includes("FATAL") ||
        stderrOutput.includes("could not connect");

      if (code !== 0 && hasCriticalError) {
        reject(
          new Error(
            `psql exited with code ${code}: ${errorMessage || stderrOutput}`
          )
        );
      } else {
        if (code !== 0) {
          console.warn(
            `⚠️ psql exited with code ${code} but no critical errors detected`
          );
        }
        console.log(`✓ Restore completed`);
        resolve();
      }
    });

    readStream.on("error", (error) => {
      hasError = true;
      reject(new Error(`Read stream error: ${error.message}`));
    });

    gunzip.on("error", (error) => {
      hasError = true;
      reject(new Error(`Gunzip error: ${error.message}`));
    });

    filterStream.on("error", (error) => {
      hasError = true;
      reject(new Error(`Filter stream error: ${error.message}`));
    });
  });
}

// ============================================================
// OTHER DATABASE OPERATIONS
// ============================================================

async function createDatabase(dbConfig, dbName) {
  const client = new Client({
    host: dbConfig.host,
    port: dbConfig.port || 5432,
    user: dbConfig.user,
    database: "postgres", // Connect to postgres db to create new db
    password: dbConfig.password || "",
  });

  try {
    await client.connect();
    await client.query(
      `CREATE DATABASE "${dbName}" WITH TEMPLATE template0 ENCODING 'UTF8';`
    );
    await client.end();
    console.log(`✓ Database created: ${dbName}`);
  } catch (err) {
    try {
      await client.end();
    } catch (_) {}
    throw new Error(`Failed to create database: ${err.message}`);
  }
}

async function dropDatabase(dbConfig, dbName) {
  const client = new Client({
    host: dbConfig.host,
    port: dbConfig.port || 5432,
    user: dbConfig.user,
    database: "postgres",
    password: dbConfig.password || "",
  });

  try {
    await client.connect();

    // Terminate connections first
    await client.query(
      `
      SELECT pg_terminate_backend(pid) 
      FROM pg_stat_activity 
      WHERE datname = $1 AND pid <> pg_backend_pid();
    `,
      [dbName]
    );

    await new Promise((resolve) => setTimeout(resolve, 1000));

    await client.query(`DROP DATABASE IF EXISTS "${dbName}";`);
    await client.end();
    console.log(`✓ Database dropped: ${dbName}`);
  } catch (err) {
    try {
      await client.end();
    } catch (_) {}
    throw new Error(`Failed to drop database: ${err.message}`);
  }
}

async function renameDatabase(dbConfig, fromName, toName) {
  console.log(`🔄 Renaming database: ${fromName} -> ${toName}`);

  const client = new Client({
    host: dbConfig.host,
    port: dbConfig.port || 5432,
    user: dbConfig.user,
    database: "postgres",
    password: dbConfig.password || "",
  });

  try {
    await client.connect();

    // ✅ Disable connections and terminate
    await client.query(
      `UPDATE pg_database SET datallowconn = false WHERE datname = $1;`,
      [fromName]
    );

    await client.query(
      `SELECT pg_terminate_backend(pid) 
       FROM pg_stat_activity 
       WHERE datname = $1 AND pid <> pg_backend_pid();`,
      [fromName]
    );

    // ✅ Wait for termination
    await new Promise((resolve) => setTimeout(resolve, 3000)); // Increased from 2000

    // ✅ Perform rename
    await client.query(`ALTER DATABASE "${fromName}" RENAME TO "${toName}";`);

    // ✅ Re-enable connections on the renamed database
    await client.query(
      `UPDATE pg_database SET datallowconn = true WHERE datname = $1;`,
      [toName]
    );

    await client.end();

    // ✅ Additional wait for rename to fully propagate
    await new Promise((resolve) => setTimeout(resolve, 2000));

    console.log(`✅ Database renamed: ${fromName} -> ${toName}`);
  } catch (err) {
    try {
      await client.end();
    } catch (_) {}
    throw new Error(`Failed to rename database: ${err.message}`);
  }
}
async function terminateDbConnections(dbConfig, dbName) {
  console.log(`🔌 Terminating connections to: ${dbName}`);

  const client = new Client({
    host: dbConfig.host,
    port: dbConfig.port || 5432,
    user: dbConfig.user,
    database: "postgres",
    password: dbConfig.password || "",
  });

  try {
    await client.connect();

    // ✅ First, prevent new connections
    await client.query(
      `UPDATE pg_database SET datallowconn = false WHERE datname = $1;`,
      [dbName]
    );

    // ✅ Wait a moment for in-flight connections to register
    await new Promise((resolve) => setTimeout(resolve, 1000));

    // ✅ Get count of active connections
    const countResult = await client.query(
      `SELECT count(*) as count FROM pg_stat_activity 
       WHERE datname = $1 AND pid <> pg_backend_pid();`,
      [dbName]
    );
    console.log(
      `📊 Active connections to terminate: ${countResult.rows[0].count}`
    );

    // ✅ Terminate all connections
    await client.query(
      `SELECT pg_terminate_backend(pid) 
       FROM pg_stat_activity 
       WHERE datname = $1 AND pid <> pg_backend_pid();`,
      [dbName]
    );

    await client.end();

    // ✅ Wait for termination to complete (increased wait time)
    console.log("⏳ Waiting for connections to fully terminate...");
    await new Promise((resolve) => setTimeout(resolve, 3000)); // Increased from 2000

    console.log(`✅ Connections terminated for ${dbName}`);
  } catch (err) {
    try {
      await client.end();
    } catch (_) {}
    console.warn(`⚠️ Warning terminating connections: ${err.message}`);

    // ✅ Still wait even if termination had issues
    await new Promise((resolve) => setTimeout(resolve, 3000));
  }
}

async function verifyDatabaseIsHealthy(dbConfig, dbName, retries = 5) {
  console.log(`🔍 Verifying database health: ${dbName}`);

  for (let i = 0; i < retries; i++) {
    const client = new Client({
      host: dbConfig.host,
      port: dbConfig.port || 5432,
      user: dbConfig.user,
      database: dbName,
      password: dbConfig.password || "",
      connectionTimeoutMillis: 10000, // ✅ Increased from 5000
    });

    try {
      await client.connect();

      // ✅ Run multiple verification queries
      await client.query("SELECT 1 as ok");
      await client.query("SELECT current_database()");

      // ✅ Check if database accepts connections
      const result = await client.query(
        "SELECT datallowconn FROM pg_database WHERE datname = $1",
        [dbName]
      );

      if (result.rows[0] && result.rows[0].datallowconn === false) {
        throw new Error("Database does not allow connections");
      }

      await client.end();
      console.log(`✅ Database ${dbName} is healthy (attempt ${i + 1})`);
      return true;
    } catch (err) {
      console.log(
        `⚠️ Verification attempt ${i + 1}/${retries} failed: ${err.message}`
      );

      try {
        await client.end();
      } catch (_) {}

      if (i === retries - 1) {
        console.error(
          `❌ Database ${dbName} verification failed after ${retries} attempts`
        );
        return false;
      }

      // ✅ Exponential backoff
      const waitTime = Math.min(1000 * Math.pow(2, i), 8000);
      console.log(`⏳ Waiting ${waitTime}ms before retry...`);
      await new Promise((r) => setTimeout(r, waitTime));
    }
  }
  return false;
}

function buildDbConfigs() {
  const local = {
    host: process.env.DB_HOST_LOCAL || "127.0.0.1",
    port: process.env.DB_PORT_LOCAL || 5432,
    database: process.env.DB_NAME_LOCAL || process.env.DB_NAME,
    user: process.env.DB_USER_LOCAL || process.env.DB_USER_NAME,
    password: process.env.DB_PASSWORD_LOCAL || process.env.DB_PASSWORD,
  };

  const remote = {
    host: process.env.DB_HOST,
    port: process.env.DB_PORT || 5432,
    database: process.env.DB_NAME,
    user: process.env.DB_USER_NAME,
    password: process.env.DB_PASSWORD,
  };

  if (!local.host || !local.database || !local.user) {
    throw new Error("Invalid local database configuration");
  }
  if (!remote.host || !remote.database || !remote.user) {
    throw new Error("Invalid remote database configuration");
  }

  return { local, remote };
}

// ============================================================
// MAIN SWAP FUNCTION
// ============================================================

async function safeSwapDatabases({ direction, ftpConfig = null }) {
  const { local, remote } = buildDbConfigs();
  const source = direction === "localToRemote" ? local : remote;
  const target = direction === "localToRemote" ? remote : local;

  console.log(`\n${"=".repeat(60)}`);
  console.log(`🔄 DATABASE SWAP: ${direction}`);
  console.log(`   Source: ${source.database} @ ${source.host}`);
  console.log(`   Target: ${target.database} @ ${target.host}`);
  console.log(`${"=".repeat(60)}\n`);

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const uid = uuidv4().slice(0, 8);

  // ✅ Simpler naming (remove complex timestamp formatting)
  const simpleTimestamp = new Date()
    .toISOString()
    .split(".")[0]
    .replace(/[^0-9]/g, "");
  const stagingDb = `${target.database}_staging_${uid}`;
  const targetBackupDb = `${target.database}_backup_${uid}`;

  const sourceDumpName = `swap-source-${timestamp}-${uid}.sql.gz`;
  const targetDumpName = `swap-target-${timestamp}-${uid}.sql.gz`;
  const sourceDumpPath = path.join(TMP_DIR, sourceDumpName);
  const targetDumpPath = path.join(TMP_DIR, targetDumpName);

  console.log(`📦 Staging DB: ${stagingDb}`);
  console.log(`💾 Backup DB: ${targetBackupDb}\n`);

  try {
    // [PHASE 1] Verify connections
    console.log("[PHASE 1] Verifying database connections...");
    await verifyConnection(source);
    await verifyConnection(target);
    console.log("✅ Both databases accessible\n");

    // [PHASE 2] Create dumps
    console.log("[PHASE 2] Creating database dumps...");
    await dumpDatabaseToGzip(source, sourceDumpName);
    await dumpDatabaseToGzip(target, targetDumpName);
    console.log("✅ Dumps created\n");

    // [PHASE 3] FTP backup (optional)
    if (ftpConfig && typeof ftpConfig === "object") {
      console.log("[PHASE 3] Uploading to FTP...");
      await backupAndPushToFTP(target, ftpConfig);
      console.log("✅ FTP backup complete\n");
    }

    // [PHASE 4] Create and restore staging
    console.log("[PHASE 4] Creating staging database...");
    await createDatabase(target, stagingDb);

    console.log("[PHASE 4] Restoring into staging...");
    await restoreDumpInto(target, stagingDb, sourceDumpPath);
    console.log("✅ Staging database ready\n");

    // [PHASE 5] Verify staging
    console.log("[PHASE 5] Verifying staging database...");
    await new Promise((r) => setTimeout(r, 3000)); // ✅ Wait before verification

    const stagingOk = await verifyDatabaseIsHealthy(target, stagingDb, 5);
    if (!stagingOk) {
      throw new Error("Staging database verification failed - aborting swap");
    }
    console.log("✅ Staging verified\n");

    // [PHASE 6] Perform the swap
    console.log("[PHASE 6] Performing database swap...");

    // ✅ Terminate connections to target database
    await terminateDbConnections(target, target.database);

    // ✅ Rename target to backup
    console.log(`   Renaming ${target.database} -> ${targetBackupDb}...`);
    await renameDatabase(target, target.database, targetBackupDb);

    // ✅ Rename staging to target
    console.log(`   Renaming ${stagingDb} -> ${target.database}...`);
    await renameDatabase(target, stagingDb, target.database);

    console.log("✅ Database swap complete\n");

    // [PHASE 7] Post-swap verification
    console.log("[PHASE 7] Post-swap verification...");

    // ✅ Longer wait before verification
    await new Promise((r) => setTimeout(r, 5000));

    const targetOk = await verifyDatabaseIsHealthy(target, target.database, 5);

    if (!targetOk) {
      console.error("❌ POST-SWAP VERIFICATION FAILED! Attempting rollback...");

      try {
        // ✅ Terminate connections before rollback
        await terminateDbConnections(target, target.database);

        // Rollback: rename current target back to staging
        await renameDatabase(target, target.database, stagingDb);

        // Rollback: rename backup back to target
        await renameDatabase(target, targetBackupDb, target.database);

        console.log("✅ Rollback renames complete, verifying...");

        // ✅ Wait before rollback verification
        await new Promise((r) => setTimeout(r, 5000));

        const rollbackOk = await verifyDatabaseIsHealthy(
          target,
          target.database,
          5
        );

        if (!rollbackOk) {
          console.error("💀 CRITICAL: ROLLBACK VERIFICATION FAILED!");
          console.error(`   Original database may be at: ${targetBackupDb}`);
          console.error(`   Failed swap at: ${stagingDb}`);
          throw new Error("CRITICAL FAILURE: ROLLBACK VERIFICATION FAILED!");
        }

        console.log("✅ Rollback successful, original database restored");
        throw new Error(
          "Post-swap verification failed; rollback completed successfully"
        );
      } catch (rollbackErr) {
        console.error("💀 ROLLBACK ERROR:", rollbackErr.message);
        throw new Error(
          `Post-swap verification failed. Rollback error: ${rollbackErr.message}. ` +
            `Check databases: ${targetBackupDb} (original), ${stagingDb} (new)`
        );
      }
    }

    console.log("✅ Post-swap verification passed\n");
    console.log(`${"=".repeat(60)}`);
    console.log("✅ SWAP COMPLETED SUCCESSFULLY");
    console.log(`${"=".repeat(60)}\n`);

    return {
      success: true,
      message: `Swap completed: ${source.database} -> ${target.database}`,
      files: { sourceDumpPath, targetDumpPath },
      targetBackupDb,
      stagingDb: null, // staging was renamed to target
    };
  } catch (err) {
    console.error("\n❌ SWAP FAILED:", err.message);

    try {
      // ✅ Cleanup staging if it still exists
      await dropDatabase(target, stagingDb).catch((e) => {
        console.log(`Note: Could not drop staging db: ${e.message}`);
      });
    } catch (_) {}

    throw err;
  }
}

// ============================================================
// CONTROLLERS (keep your existing controller code)
// ============================================================

const swapModeSafeController = catchAsync(async function (req, res) {
  const targetMode = req.body.mode || req.params.mode;

  if (!["online", "offline"].includes(targetMode)) {
    throw new AppError("Invalid mode", StatusCodes.BAD_REQUEST);
  }

  let oldMode = null;
  let sourceClient = null;

  try {
    console.log(`\n${"=".repeat(60)}`);
    console.log(`INITIATING DATABASE SWAP`);
    console.log(`Target Mode: ${targetMode.toUpperCase()}`);
    console.log(`${"=".repeat(60)}\n`);

    const direction =
      targetMode === "online" ? "localToRemote" : "remoteToLocal";

    // ✅ Get source database config
    const { local, remote } = buildDbConfigs();
    const sourceDb = direction === "localToRemote" ? local : remote;

    console.log(`📊 Updating mode in source database BEFORE swap...`);
    console.log(`   Source DB: ${sourceDb.database} @ ${sourceDb.host}`);

    // ✅ Update mode in SOURCE database using pg.Client (not Sequelize)
    sourceClient = new Client({
      host: sourceDb.host,
      port: sourceDb.port || 5432,
      user: sourceDb.user,
      database: sourceDb.database,
      password: sourceDb.password || "",
    });

    await sourceClient.connect();

    // ✅ Get current mode for rollback purposes
    const currentModeResult = await sourceClient.query(
      "SELECT mode FROM system_mode LIMIT 1"
    );
    oldMode = currentModeResult.rows[0]?.mode;
    console.log(`   Current mode: ${oldMode}`);

    if (oldMode === targetMode) {
      await sourceClient.end();
      console.log(`✓ Already in "${targetMode}" mode - no swap needed`);

      const row = await SystemMode.findOne();
      return appResponder(
        StatusCodes.OK,
        {
          status: "success",
          message: `Already in "${targetMode}" — no change`,
          data: row,
        },
        res
      );
    }

    // ✅ Update mode in source database (all rows)
    await sourceClient.query("UPDATE system_mode SET mode = $1", [targetMode]);

    // Verify update
    const verifyResult = await sourceClient.query(
      "SELECT mode FROM system_mode LIMIT 1"
    );
    console.log(
      `✓ Mode in source DB updated to: ${verifyResult.rows[0]?.mode}`
    );

    await sourceClient.end();
    sourceClient = null;

    const ftpConfig = {
      host: process.env.FTP_HOST,
      port: process.env.FTP_PORT || 21,
      user: process.env.FTP_USER,
      password: process.env.FTP_PASS,
      remoteDir: "/backups",
    };

    // Perform the swap (may close Sequelize)
    const swapResult = await safeSwapDatabases({
      direction,
      ftpConfig: ftpConfig.host ? ftpConfig : null,
      userId: req.user?.id || 1,
    });

    // Ensure Sequelize reconnected if closed
    await ensureSequelizeConnected();

    // ✅ Verify the mode is correct in the swapped database
    const row = await SystemMode.findOne();
    console.log(`📊 Mode in swapped database: ${row?.mode}`);

    // Start transaction for logging
    const dbTransaction = await sequelize.transaction();

    try {
      // Log the change
      await logChanges(
        "system_mode",
        1,
        ChangeTypes.update,
        {
          id: 1,
        } || 1,
        { before: { mode: oldMode }, after: { mode: targetMode } },
        dbTransaction
      );

      await dbTransaction.commit();

      return appResponder(
        StatusCodes.OK,
        {
          status: "success",
          message: `System mode switched to "${targetMode}"`,
          data: row,
          swapDetails: swapResult,
        },
        res
      );
    } catch (transactionErr) {
      await dbTransaction.rollback();
      console.warn(
        "Failed to log change (non-critical):",
        transactionErr.message
      );

      // Still return success since the swap completed
      return appResponder(
        StatusCodes.OK,
        {
          status: "success",
          message: `System mode switched to "${targetMode}" (logging failed)`,
          data: row,
          swapDetails: swapResult,
        },
        res
      );
    }
  } catch (err) {
    console.error("❌ Mode swap controller error:", err);

    // ✅ ROLLBACK: Revert mode in source database if swap failed
    if (oldMode && sourceClient) {
      try {
        console.log(`🔄 Rolling back mode to: ${oldMode}`);
        await sourceClient.query("UPDATE system_mode SET mode = $1", [oldMode]);
        console.log(`✓ Mode rolled back to: ${oldMode}`);
        await sourceClient.end();
      } catch (rollbackErr) {
        console.error("❌ Failed to rollback mode:", rollbackErr.message);
        try {
          await sourceClient.end();
        } catch (_) {}
      }
    } else if (oldMode) {
      // sourceClient already closed, try to reconnect and rollback
      try {
        const { local, remote } = buildDbConfigs();
        const sourceDb = direction === "localToRemote" ? local : remote;

        const rollbackClient = new Client({
          host: sourceDb.host,
          port: sourceDb.port || 5432,
          user: sourceDb.user,
          database: sourceDb.database,
          password: sourceDb.password || "",
        });

        await rollbackClient.connect();
        await rollbackClient.query("UPDATE system_mode SET mode = $1", [
          oldMode,
        ]);
        console.log(`✓ Mode rolled back to: ${oldMode}`);
        await rollbackClient.end();
      } catch (rollbackErr) {
        console.error("❌ Failed to rollback mode:", rollbackErr.message);
      }
    }

    // Ensure Sequelize reconnected even on error
    try {
      await ensureSequelizeConnected();
    } catch (reconnectErr) {
      console.error("❌ Failed to reconnect Sequelize:", reconnectErr.message);
    }

    throw new AppError(
      `Failed to swap mode: ${err.message}`,
      StatusCodes.INTERNAL_SERVER_ERROR
    );
  }
});
async function reconnectSequelize() {
  try {
    await sequelize.authenticate();
    console.log("✓ Sequelize already connected");
    return true;
  } catch (err) {
    console.log("⚠️ Sequelize not connected, reconnecting...");

    try {
      // Close old connection manager
      if (sequelize.connectionManager) {
        await sequelize.connectionManager.close().catch(() => {});
      }

      // ✅ Get fresh config
      const { remote } = buildDbConfigs();

      // ✅ Update config properly
      sequelize.config.database = remote.database;
      sequelize.config.host = remote.host;
      sequelize.config.port = remote.port;
      sequelize.config.username = remote.user;
      sequelize.config.password = remote.password;

      // ✅ Ensure dialect is set
      if (!sequelize.config.dialect) {
        sequelize.config.dialect = "postgres";
      }

      // ✅ Re-initialize connection pool
      sequelize.connectionManager.initPools();

      // Test connection
      await sequelize.authenticate();

      console.log("✓ Sequelize reconnected successfully");
      return true;
    } catch (reconnectErr) {
      console.error("❌ Failed to reconnect:", reconnectErr.message);
      throw new Error(`Database reconnection failed: ${reconnectErr.message}`);
    }
  }
}

// Add this helper function
async function ensureSequelizeConnected() {
  try {
    // Check if connection manager is open
    await sequelize.authenticate();
    console.log("✓ Sequelize already connected");
    return true;
  } catch (err) {
    console.log("Sequelize not connected, reconnecting...");

    try {
      // Close the old connection manager
      if (sequelize.connectionManager) {
        try {
          await sequelize.connectionManager.close();
        } catch (_) {}
      }

      // Create new connection manager by re-initializing the pool
      const { Sequelize } = require("sequelize");

      // Get current config
      const config = sequelize.config;

      // Re-create Sequelize instance with same config
      const newSequelize = new Sequelize(
        config.database,
        config.username,
        config.password,
        {
          host: config.host,
          port: config.port,
          dialect: config.dialect,
          logging: config.logging,
          pool: config.pool,
          dialectOptions: config.dialectOptions,
        }
      );

      // Test connection
      await newSequelize.authenticate();
      console.log("✓ New Sequelize connection established");

      // Replace the global sequelize instance
      // This is a bit hacky but necessary
      Object.assign(sequelize, newSequelize);

      // Re-sync models
      Object.keys(sequelize.models).forEach((modelName) => {
        const model = sequelize.models[modelName];
        model.sequelize = sequelize;
      });

      return true;
    } catch (reconnectErr) {
      console.error("Failed to reconnect Sequelize:", reconnectErr);
      throw new Error(`Database reconnection failed: ${reconnectErr.message}`);
    }
  }
}

async function initSubject() {
  try {
    const tables = await SystemMode.sequelize
      .getQueryInterface()
      .showAllTables();
    if (!tables.includes(SystemMode.tableName)) {
      await SystemMode.sync({ force: false });
      console.log("SystemMode table initialized");
    }
  } catch (err) {
    console.error("Failed to initialize SystemMode table:", err);
  }
}

async function initDbSwapLog() {
  try {
    const tables = await DbSwapLog.sequelize
      .getQueryInterface()
      .showAllTables();
    if (!tables.includes(DbSwapLog.tableName)) {
      await DbSwapLog.sync({ force: false });
      console.log("DbSwapLog table initialized");
    }
  } catch (err) {
    console.error("Failed to initialize DbSwapLog table:", err);
  }
}

initSubject();
initDbSwapLog();

const validateMode = [
  body("mode")
    .isIn(["online", "offline", "maintenance"])
    .withMessage("mode must be online | offline | maintenance"),
];

const getSystemMode = catchAsync(async (req, res) => {
  const row = await SystemMode.findOne({ raw: true });
  if (!row) {
    throw new AppError(
      "System-mode row missing",
      StatusCodes.INTERNAL_SERVER_ERROR
    );
  }
  return appResponder(StatusCodes.OK, { status: "success", data: row }, res);
});

const goOnline = catchAsync(async (req, res) => {
  req.body.mode = "online";
  return swapModeSafeController(req, res);
});

const goOffline = catchAsync(async (req, res) => {
  req.body.mode = "offline";
  return swapModeSafeController(req, res);
});

const readOnlyGate = catchAsync(async (req, res, next) => {
  const verb = req.method.toUpperCase();
  const row = await SystemMode.findOne({ raw: true });

  if (!row) {
    return next(
      new AppError("System-mode row missing", StatusCodes.INTERNAL_SERVER_ERROR)
    );
  }

  if (
    (row.mode === "offline" || row.mode === "maintenance") &&
    verb !== "GET"
  ) {
    return next(
      new AppError(
        `Server is in ${row.mode.toUpperCase()} mode – only read operations allowed`,
        StatusCodes.SERVICE_UNAVAILABLE
      )
    );
  }

  next();
});

module.exports = {
  getSystemMode,
  readOnlyGate,
  validateMode,
  goOnline,
  goOffline,
  swapModeSafeController,
  safeSwapDatabases,
};
