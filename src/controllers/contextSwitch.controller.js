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

const TMP_DIR = path.join(__dirname, "../../temp", "db-swaps");
const SWAP_LOCK_FILE = path.join(TMP_DIR, ".swap.lock");
const IS_WINDOWS = process.platform === "win32";

// PostgreSQL binary paths
const PG_BIN_PATH =
  process.env.PG_BIN_PATH ||
  (IS_WINDOWS ? "C:\\portable-postgres\\pgsql\\bin" : "/usr/bin");

// Initialize directories
(async () => {
  try {
    await fs.mkdir(TMP_DIR, { recursive: true });
    console.log("✓ Temp directory initialized:", TMP_DIR);
  } catch (err) {
    console.error("Failed to create temp directory:", err);
  }
})();

// ============================================================
// UTILITIES
// ============================================================

function getPgCommand(command) {
  const extension = IS_WINDOWS ? ".exe" : "";
  const pgPath = path.join(PG_BIN_PATH, `${command}${extension}`);

  if (fsSync.existsSync(pgPath)) {
    return `"${pgPath}"`;
  }
  return command;
}

async function checkDiskSpace(requiredBytes) {
  try {
    if (IS_WINDOWS) {
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
          ).toFixed(2)}MB, Available: ${(availableBytes / 1024 / 1024).toFixed(
            2
          )}MB`
        );
      }
    } else {
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
          ).toFixed(2)}MB, Available: ${(availableBytes / 1024 / 1024).toFixed(
            2
          )}MB`
        );
      }
    }
    return true;
  } catch (err) {
    console.warn("Could not verify disk space:", err.message);
    return true;
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
        console.log("✓ Lock acquired:", lockId);
        return true;
      } catch (err) {
        if (err.code === "EEXIST") {
          try {
            const stats = await fs.stat(SWAP_LOCK_FILE);
            const ageMs = Date.now() - stats.mtimeMs;
            if (ageMs > 3600000) {
              // 1 hour stale lock
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
          console.log("✓ Lock released:", this.lockId);
        }
      } catch (_) {}
      this.locked = false;
      this.lockId = null;
    }
  }
}

// ============================================================
// DATABASE OPERATIONS
// ============================================================

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
    throw new Error(
      `Cannot connect to ${dbConfig.database} at ${dbConfig.host}: ${err.message}`
    );
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

async function dumpDatabaseToGzip(dbConfig, dstFilename) {
  const outPath = path.join(TMP_DIR, dstFilename);

  return new Promise((resolve, reject) => {
    console.log(`📦 Creating dump: ${dstFilename}`);

    const connectionString = `postgresql://${dbConfig.user}:${
      dbConfig.password
    }@${dbConfig.host}:${dbConfig.port || 5432}/${dbConfig.database}`;

    const pgDumpPath = getPgCommand("pg_dump");

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

    const gzip = zlib.createGzip({ level: 9 });
    const writeStream = fsSync.createWriteStream(outPath);

    let hasError = false;
    let errorMessage = "";

    pgDump.stdout.pipe(gzip).pipe(writeStream);

    pgDump.stderr.on("data", (data) => {
      const message = data.toString();
      if (message.includes("ERROR")) {
        console.error(`pg_dump error: ${message}`);
        errorMessage += message;
      }
    });

    pgDump.on("error", (error) => {
      hasError = true;
      reject(new Error(`Failed to spawn pg_dump: ${error.message}`));
    });

    writeStream.on("finish", async () => {
      if (hasError) return;

      try {
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

async function restoreDumpInto(dbConfig, dbName, gzipDumpPath) {
  return new Promise((resolve, reject) => {
    console.log(`📥 Restoring dump into ${dbName}...`);

    const connectionString = `postgresql://${dbConfig.user}:${
      dbConfig.password
    }@${dbConfig.host}:${dbConfig.port || 5432}/${dbName}`;

    const psqlPath = getPgCommand("psql");

    const psql = spawn(
      psqlPath,
      [
        connectionString,
        "--set",
        "ON_ERROR_STOP=off",
        "-q",
        "--variable=ON_ERROR_ROLLBACK=on",
      ],
      {
        env: { ...process.env, PGPASSWORD: dbConfig.password || "" },
        shell: IS_WINDOWS,
      }
    );

    const { Transform } = require("stream");

    const filterStream = new Transform({
      transform(chunk, encoding, callback) {
        let data = chunk.toString();
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

    const gunzip = zlib.createGunzip();
    const readStream = fsSync.createReadStream(gzipDumpPath);

    let hasError = false;
    let stderrOutput = "";

    readStream.pipe(gunzip).pipe(filterStream).pipe(psql.stdin);

    psql.stderr.on("data", (data) => {
      const message = data.toString();
      stderrOutput += message;

      if (
        message.includes("ERROR") &&
        !message.includes("transaction_timeout")
      ) {
        console.error(`psql error: ${message}`);
      }
    });

    psql.on("error", (error) => {
      hasError = true;
      reject(new Error(`Failed to spawn psql: ${error.message}`));
    });

    psql.on("close", (code) => {
      const hasCriticalError =
        stderrOutput.includes("FATAL") ||
        stderrOutput.includes("could not connect");

      if (code !== 0 && hasCriticalError) {
        reject(new Error(`psql exited with code ${code}: ${stderrOutput}`));
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

async function createDatabase(dbConfig, dbName) {
  const client = new Client({
    host: dbConfig.host,
    port: dbConfig.port || 5432,
    user: dbConfig.user,
    database: "postgres",
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

    await client.query(
      `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid();`,
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

    await client.query(
      `UPDATE pg_database SET datallowconn = false WHERE datname = $1;`,
      [dbName]
    );

    await new Promise((resolve) => setTimeout(resolve, 1000));

    const countResult = await client.query(
      `SELECT count(*) as count FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid();`,
      [dbName]
    );
    console.log(
      `   Active connections to terminate: ${countResult.rows[0].count}`
    );

    await client.query(
      `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid();`,
      [dbName]
    );

    await client.end();

    console.log("   Waiting for connections to fully terminate...");
    await new Promise((resolve) => setTimeout(resolve, 3000));

    console.log(`✓ Connections terminated for ${dbName}`);
  } catch (err) {
    try {
      await client.end();
    } catch (_) {}
    console.warn(`⚠️ Warning terminating connections: ${err.message}`);
    await new Promise((resolve) => setTimeout(resolve, 3000));
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

    await client.query(
      `UPDATE pg_database SET datallowconn = false WHERE datname = $1;`,
      [fromName]
    );

    await client.query(
      `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = $1 AND pid <> pg_backend_pid();`,
      [fromName]
    );

    await new Promise((resolve) => setTimeout(resolve, 3000));

    await client.query(`ALTER DATABASE "${fromName}" RENAME TO "${toName}";`);

    await client.query(
      `UPDATE pg_database SET datallowconn = true WHERE datname = $1;`,
      [toName]
    );

    await client.end();

    await new Promise((resolve) => setTimeout(resolve, 2000));

    console.log(`✓ Database renamed: ${fromName} -> ${toName}`);
  } catch (err) {
    try {
      await client.end();
    } catch (_) {}
    throw new Error(`Failed to rename database: ${err.message}`);
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
      connectionTimeoutMillis: 10000,
    });

    try {
      await client.connect();

      await client.query("SELECT 1 as ok");
      await client.query("SELECT current_database()");

      const result = await client.query(
        "SELECT datallowconn FROM pg_database WHERE datname = $1",
        [dbName]
      );

      if (result.rows[0] && result.rows[0].datallowconn === false) {
        throw new Error("Database does not allow connections");
      }

      await client.end();
      console.log(`✓ Database ${dbName} is healthy (attempt ${i + 1})`);
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

      const waitTime = Math.min(1000 * Math.pow(2, i), 8000);
      console.log(`   Waiting ${waitTime}ms before retry...`);
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

  const timestamp = new Date()
    .toISOString()
    .split(".")[0]
    .replace(/[^0-9]/g, "");
  const uid = uuidv4().slice(0, 8);

  const stagingDb = `${target.database}_staging_${uid}`;
  const targetBackupDb = `${target.database}_backup_${uid}`;

  const sourceDumpName = `swap-source-${timestamp}-${uid}.sql.gz`;
  const targetDumpName = `swap-target-${timestamp}-${uid}.sql.gz`;

  console.log(`📦 Staging DB: ${stagingDb}`);
  console.log(`💾 Backup DB: ${targetBackupDb}\n`);

  let stagingCreated = false;
  let swapPerformed = false;

  try {
    // [PHASE 1] Verify connections
    console.log("[PHASE 1] Verifying database connections...");
    await verifyConnection(source);
    await verifyConnection(target);
    console.log("✓ Both databases accessible\n");

    // [PHASE 2] Create dumps
    console.log("[PHASE 2] Creating database dumps...");
    await dumpDatabaseToGzip(source, sourceDumpName);
    await dumpDatabaseToGzip(target, targetDumpName);
    console.log("✓ Dumps created\n");

    // [PHASE 3] FTP backup (optional)
    if (ftpConfig && typeof ftpConfig === "object" && ftpConfig.host) {
      console.log("[PHASE 3] Uploading to FTP...");
      try {
        await backupAndPushToFTP(target, ftpConfig);
        console.log("✓ FTP backup complete\n");
      } catch (ftpErr) {
        console.warn(
          `⚠️ FTP backup failed (non-critical): ${ftpErr.message}\n`
        );
      }
    }

    // [PHASE 4] Create and restore staging
    console.log("[PHASE 4] Creating staging database...");
    await createDatabase(target, stagingDb);
    stagingCreated = true;

    console.log("[PHASE 4] Restoring into staging...");
    await restoreDumpInto(
      target,
      stagingDb,
      path.join(TMP_DIR, sourceDumpName)
    );
    console.log("✓ Staging database ready\n");

    // [PHASE 5] Verify staging
    console.log("[PHASE 5] Verifying staging database...");
    await new Promise((r) => setTimeout(r, 3000));

    const stagingOk = await verifyDatabaseIsHealthy(target, stagingDb, 5);
    if (!stagingOk) {
      throw new Error("Staging database verification failed - aborting swap");
    }
    console.log("✓ Staging verified\n");

    // [PHASE 6] Perform the swap
    console.log("[PHASE 6] Performing database swap...");

    await terminateDbConnections(target, target.database);

    console.log(`   Renaming ${target.database} -> ${targetBackupDb}...`);
    await renameDatabase(target, target.database, targetBackupDb);

    console.log(`   Renaming ${stagingDb} -> ${target.database}...`);
    await renameDatabase(target, stagingDb, target.database);

    swapPerformed = true;
    stagingCreated = false; // Staging was renamed, not a separate DB anymore

    console.log("✓ Database swap complete\n");

    // [PHASE 7] Post-swap verification
    console.log("[PHASE 7] Post-swap verification...");
    await new Promise((r) => setTimeout(r, 5000));

    const targetOk = await verifyDatabaseIsHealthy(target, target.database, 5);

    if (!targetOk) {
      console.error("❌ POST-SWAP VERIFICATION FAILED! Attempting rollback...");

      try {
        await terminateDbConnections(target, target.database);

        // Rollback: rename current target back to staging
        await renameDatabase(target, target.database, stagingDb);

        // Rollback: rename backup back to target
        await renameDatabase(target, targetBackupDb, target.database);

        console.log("✓ Rollback renames complete, verifying...");
        await new Promise((r) => setTimeout(r, 5000));

        const rollbackOk = await verifyDatabaseIsHealthy(
          target,
          target.database,
          5
        );

        if (!rollbackOk) {
          throw new Error(
            `CRITICAL: Rollback verification failed! Original database may be at: ${targetBackupDb}`
          );
        }

        console.log("✓ Rollback successful, original database restored");

        // Clean up the failed staging database
        try {
          await dropDatabase(target, stagingDb);
        } catch (e) {
          console.warn(`Could not drop failed staging db: ${e.message}`);
        }

        throw new Error("Post-swap verification failed; rollback completed");
      } catch (rollbackErr) {
        console.error("💀 ROLLBACK ERROR:", rollbackErr.message);
        throw new Error(
          `Post-swap verification failed. Rollback error: ${rollbackErr.message}. ` +
            `Check databases: ${targetBackupDb} (original), ${stagingDb} (new)`
        );
      }
    }

    console.log("✓ Post-swap verification passed\n");

    // Clean up old backup database
    console.log(`Cleaning up old backup: ${targetBackupDb}...`);
    try {
      await dropDatabase(target, targetBackupDb);
      console.log(`✓ Old backup cleaned up\n`);
    } catch (e) {
      console.warn(
        `⚠️ Could not drop backup db (non-critical): ${e.message}\n`
      );
    }

    console.log(`${"=".repeat(60)}`);
    console.log("✅ SWAP COMPLETED SUCCESSFULLY");
    console.log(`${"=".repeat(60)}\n`);

    return {
      success: true,
      message: `Swap completed: ${source.database} -> ${target.database}`,
      files: {
        sourceDump: sourceDumpName,
        targetDump: targetDumpName,
      },
      direction,
      timestamp: new Date().toISOString(),
    };
  } catch (err) {
    console.error("\n❌ SWAP FAILED:", err.message);

    // Cleanup staging if it still exists and swap wasn't performed
    if (stagingCreated && !swapPerformed) {
      try {
        console.log("Cleaning up failed staging database...");
        await dropDatabase(target, stagingDb);
      } catch (e) {
        console.log(`Note: Could not drop staging db: ${e.message}`);
      }
    }

    throw err;
  }
}

// ============================================================
// CONTROLLER
// ============================================================

const swapModeSafeController = catchAsync(async function (req, res) {
  const targetMode = req.body.mode || req.params.mode;

  // Validate mode
  if (!["online", "offline"].includes(targetMode)) {
    throw new AppError(
      'Invalid mode. Must be "online" or "offline"',
      StatusCodes.BAD_REQUEST
    );
  }

  const lock = new SwapLock();

  try {
    // ============================================================
    // STEP 1: Acquire lock
    // ============================================================
    console.log("\n" + "=".repeat(60));
    console.log("DATABASE MODE SWAP INITIATED");
    console.log(`Target Mode: ${targetMode.toUpperCase()}`);
    console.log("=".repeat(60) + "\n");

    await lock.acquire();

    // ============================================================
    // STEP 2: Check current mode
    // ============================================================
    console.log("Checking current mode...");
    const currentModeRow = await SystemMode.findOne({ raw: true });

    if (!currentModeRow) {
      throw new AppError(
        "System mode configuration missing",
        StatusCodes.INTERNAL_SERVER_ERROR
      );
    }

    const currentMode = currentModeRow.mode;
    console.log(`Current mode: ${currentMode}`);

    // If already in target mode, return early
    if (currentMode === targetMode) {
      console.log(`✓ Already in "${targetMode}" mode - no swap needed\n`);

      const updatedRow = await SystemMode.findOne({ raw: true });

      await lock.release(); // ✅ Release lock before responding

      return appResponder(
        StatusCodes.OK,
        {
          status: "success",
          message: `System is already in "${targetMode}" mode`,
          data: updatedRow,
          swapDetails: null,
        },
        res
      );
    }

    // ============================================================
    // STEP 3: Perform database swap
    // ============================================================
    const direction =
      targetMode === "online" ? "localToRemote" : "remoteToLocal";

    const ftpConfig = {
      host: process.env.FTP_HOST,
      port: process.env.FTP_PORT || 21,
      user: process.env.FTP_USER,
      password: process.env.FTP_PASS,
      remoteDir: "/backups",
    };

    console.log(`\nPerforming database swap (${direction})...\n`);

    const swapResult = await safeSwapDatabases({
      direction,
      ftpConfig: ftpConfig.host ? ftpConfig : null,
    });

    console.log("✓ Database swap completed successfully\n");

    // ============================================================
    // STEP 4: Update mode AFTER successful swap
    // ============================================================
    // ============================================================
    // STEP 4: Update mode AFTER successful swap
    // ============================================================
    console.log("Updating system mode in database...");

    // Connect to the NEW database (after swap)
    const { local, remote } = buildDbConfigs();
    const targetDb = targetMode === "online" ? remote : local;

    const updateClient = new Client({
      host: targetDb.host,
      port: targetDb.port || 5432,
      user: targetDb.user,
      database: targetDb.database,
      password: targetDb.password || "",
    });

    try {
      await updateClient.connect();

      // ✅ Update mode without updated_at column
      const updateResult = await updateClient.query(
        "UPDATE system_mode SET mode = $1 RETURNING *",
        [targetMode]
      );

      if (updateResult.rowCount === 0) {
        throw new Error("Failed to update system mode");
      }

      console.log(`✓ Mode updated to: ${targetMode}`);
      console.log(`✓ Updated row:`, updateResult.rows[0]);

      await updateClient.end();
    } catch (updateErr) {
      try {
        await updateClient.end();
      } catch (_) {}
      throw new Error(`Failed to update mode: ${updateErr.message}`);
    }

    // ============================================================
    // STEP 5: Reconnect Sequelize to new database
    // ============================================================
    // ============================================================
    // STEP 5: Reconnect Sequelize to new database
    // ============================================================
    console.log("Reconnecting ORM to new database...");

    try {
      // DON'T close sequelize - it can't be reopened!
      // Instead, drain existing pools without closing the connection manager

      if (sequelize.connectionManager && sequelize.connectionManager.pool) {
        // Drain the pool (close idle connections)
        await sequelize.connectionManager.pool.drain();
        // await sequelize.connectionManager.pool.clear();
      }

      // Wait for connections to clear
      await new Promise((resolve) => setTimeout(resolve, 2000));

      // Update Sequelize configuration
      sequelize.config.host = targetDb.host;
      sequelize.config.port = targetDb.port;
      sequelize.config.database = targetDb.database;
      sequelize.config.username = targetDb.user;
      sequelize.config.password = targetDb.password;

      // Also update options object (Sequelize uses both)
      if (sequelize.options) {
        sequelize.options.host = targetDb.host;
        sequelize.options.port = targetDb.port;
        sequelize.options.database = targetDb.database;
      }

      // Reinitialize connection pools with new config
      if (sequelize.connectionManager) {
        sequelize.connectionManager.initPools();
      }

      // Test connection with retries
      let reconnected = false;
      const maxRetries = 5;

      for (let i = 0; i < maxRetries; i++) {
        try {
          await sequelize.authenticate();

          // Verify we're connected to the correct database
          const [result] = await sequelize.query(
            "SELECT current_database() as db"
          );
          const connectedDb = result[0].db;

          if (connectedDb !== targetDb.database) {
            throw new Error(
              `Connected to wrong database: ${connectedDb}, expected: ${targetDb.database}`
            );
          }

          reconnected = true;
          console.log(`✓ ORM reconnected to: ${connectedDb}\n`);
          break;
        } catch (err) {
          console.log(
            `   Reconnection attempt ${i + 1}/${maxRetries} failed: ${
              err.message
            }`
          );

          if (i < maxRetries - 1) {
            const waitTime = 2000 * (i + 1);
            console.log(`   Waiting ${waitTime}ms before retry...`);
            await new Promise((resolve) => setTimeout(resolve, waitTime));
          }
        }
      }

      if (!reconnected) {
        throw new Error(
          `Failed to reconnect ORM after ${maxRetries} attempts. ` +
            `Database swap succeeded but you must restart the application.`
        );
      }
    } catch (reconnectErr) {
      console.error("❌ ORM reconnection failed:", reconnectErr.message);

      // Mark that restart is needed but don't fail the whole swap
      console.error(
        "\n⚠️  ACTION REQUIRED: Please restart the application to complete the database swap.\n"
      );

      // Don't throw - we'll handle this gracefully
    }
    // ============================================================
    // STEP 6: Log the change
    // ============================================================
    try {
      console.log("Logging change to new database...");

      const logClient = new Client({
        host: targetDb.host,
        port: targetDb.port || 5432,
        user: targetDb.user,
        database: targetDb.database,
        password: targetDb.password || "",
      });

      await logClient.connect();

      // Check if change_logs table exists, if so insert
      const tableCheck = await logClient.query(`
        SELECT EXISTS (
          SELECT FROM information_schema.tables 
          WHERE table_name = 'change_logs'
        );
      `);

      if (tableCheck.rows[0].exists) {
        await logClient.query(
          `
            INSERT INTO change_logs 
            (table_name, record_id, change_type, changed_by, fields_changed, changed_at)
            VALUES ($1, $2, $3, $4, $5, NOW())
          `,
          [
            "system_mode",
            1,
            "UPDATE", // must match ENUM
            1,
            JSON.stringify({
              before: { mode: currentMode },
              after: { mode: targetMode },
            }),
          ]
        );

        console.log("✓ Change logged\n");
      } else {
        console.log("⚠️ change_logs table not found, skipping log\n");
      }

      await logClient.end();
    } catch (logErr) {
      console.warn("⚠️ Failed to log change (non-critical):", logErr.message);
    }
    // ============================================================
    // STEP 7: Get final state and respond
    // ============================================================
    const finalClient = new Client({
      host: targetDb.host,
      port: targetDb.port || 5432,
      user: targetDb.user,
      database: targetDb.database,
      password: targetDb.password || "",
    });

    let finalRow = null;

    try {
      await finalClient.connect();
      const finalResult = await finalClient.query(
        "SELECT * FROM system_mode LIMIT 1"
      );
      finalRow = finalResult.rows[0];
      await finalClient.end();
    } catch (finalErr) {
      console.warn("⚠️ Could not fetch final row:", finalErr.message);
      // Create a fallback response
      finalRow = { mode: targetMode };
    }

    console.log("=".repeat(60));
    console.log("✅ MODE SWAP COMPLETED SUCCESSFULLY");
    console.log("=".repeat(60) + "\n");

    // ✅ Release lock before responding
    await lock.release();

    // ✅ Respond immediately - don't try to use Sequelize
    return appResponder(
      StatusCodes.OK,
      {
        status: "success",
        message: `System mode switched to "${targetMode}". Server will auto-reconnect.`,
        data: finalRow,
        swapDetails: swapResult,
        note: "Database connections will refresh automatically",
      },
      res
    );
  } catch (err) {
    console.error("\n" + "=".repeat(60));
    console.error("❌ MODE SWAP FAILED");
    console.error("=".repeat(60));
    console.error(`Error: ${err.message}\n`);

    // ✅ Always release lock on error
    await lock.release();

    // Try to reconnect Sequelize even on error
    try {
      await sequelize.authenticate();
    } catch (reconnectErr) {
      console.error("⚠️ Sequelize reconnection failed:", reconnectErr.message);
    }

    // ✅ Return error response to client IMMEDIATELY
    return appResponder(
      err.statusCode || StatusCodes.INTERNAL_SERVER_ERROR,
      {
        status: "error",
        message: `Failed to switch mode: ${err.message}`,
        error: process.env.NODE_ENV === "development" ? err.stack : undefined,
      },
      res
    );
  }
});
const readOnlyGate = catchAsync(async (req, res, next) => {
  const verb = req.method.toUpperCase();

  // Always allow GET requests (read operations)
  if (verb === "GET") {
    return next();
  }

  // Get current system mode
  const row = await SystemMode.findOne({ raw: true });

  if (!row) {
    return next(
      new AppError(
        "System mode configuration missing",
        StatusCodes.INTERNAL_SERVER_ERROR
      )
    );
  }

  const currentMode = row.mode;
  const nodeEnv = process.env.NODE_ENV;

  // SCENARIO 1: Desktop (local network) + Offline mode = ALLOW
  // Local users can write when system is in offline mode
  if (nodeEnv === "desktop" && currentMode === "offline") {
    return next();
  }

  // SCENARIO 2: Production (remote server) + Online mode = ALLOW
  // Remote users can write when system is in online mode
  if (nodeEnv === "production" && currentMode === "online") {
    return next();
  }

  // ALL OTHER SCENARIOS: BLOCK
  // - Desktop + Online (should use remote server instead)
  // - Production + Offline (remote is read-only)
  // - Any maintenance mode
  return next(
    new AppError(
      "System is in offline mode - only users on Votech's Local Network may create or update",
      StatusCodes.SERVICE_UNAVAILABLE
    )
  );
});

// ============================================================
// OTHER CONTROLLERS
// ============================================================

const getSystemMode = catchAsync(async (req, res) => {
  const row = await SystemMode.findOne({ raw: true });
  if (!row) {
    throw new AppError(
      "System mode configuration missing",
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

// ============================================================
// INITIALIZATION
// ============================================================

async function initSystemMode() {
  try {
    const tables = await SystemMode.sequelize
      .getQueryInterface()
      .showAllTables();
    if (!tables.includes(SystemMode.tableName)) {
      await SystemMode.sync({ force: false });
      console.log("✓ SystemMode table initialized");
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
      console.log("✓ DbSwapLog table initialized");
    }
  } catch (err) {
    console.error("Failed to initialize DbSwapLog table:", err);
  }
}

initSystemMode();
initDbSwapLog();

// ============================================================
// VALIDATION
// ============================================================

const validateMode = [
  body("mode")
    .isIn(["online", "offline", "maintenance"])
    .withMessage("mode must be online | offline | maintenance"),
];

// ============================================================
// EXPORTS
// ============================================================

module.exports = {
  getSystemMode,
  readOnlyGate,
  validateMode,
  goOnline,
  goOffline,
  swapModeSafeController,
  safeSwapDatabases,
};
