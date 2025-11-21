"use strict";

const path = require("path");
const fs = require("fs").promises;
const fsSync = require("fs");
const { spawn } = require("child_process");
const zlib = require("zlib");
const { v4: uuidv4 } = require("uuid");
const { uploadSingleFileToFTP } = require("../services/fileStorage.service");

const IS_WINDOWS = process.platform === "win32";

const PG_BIN_PATH =
  process.env.PG_BIN_PATH ||
  (IS_WINDOWS ? "C:\\portable-postgres\\pgsql\\bin" : "/usr/bin");

const TMP_DIR = path.join(__dirname, "../../temp");

(async () => {
  try {
    await fs.mkdir(TMP_DIR, { recursive: true });
  } catch (err) {
    console.error("Failed to create temp directory:", err);
  }
})();

function getPgCommand(command) {
  const extension = IS_WINDOWS ? ".exe" : "";
  const pgPath = path.join(PG_BIN_PATH, `${command}${extension}`);

  if (fsSync.existsSync(pgPath)) {
    return pgPath;
  }

  return command;
}

async function backupAndPushToFTP(dbConfig, ftpConfig = {}) {
  const timeStamp = new Date().toISOString().replace(/[:.]/g, "-");
  const fileName = `db-backup-${timeStamp}-${uuidv4().slice(0, 8)}.sql.gz`;
  const localPath = path.join(TMP_DIR, fileName);

  try {
    if (!dbConfig || !dbConfig.database || !dbConfig.user) {
      throw new Error("Invalid database configuration");
    }

    console.log(`Creating backup: ${fileName}`);

    await fs.mkdir(path.dirname(localPath), { recursive: true });

    // Create backup
    await createBackupWithSpawn(dbConfig, localPath);

    console.log(`Waiting for file system to flush...`);
    await new Promise((resolve) => setTimeout(resolve, 1000)); // Give FS time to flush

    // Verify backup file exists and has size
    const stats = await fs.stat(localPath);
    console.log(`Backup file size: ${(stats.size / 1024 / 1024).toFixed(2)}MB`);

    if (stats.size < 100) {
      throw new Error("Backup file is too small - backup may have failed");
    }

    // Verify gzip integrity by trying to decompress the whole file
    console.log("Verifying backup integrity...");
    await verifyGzipFile(localPath);
    console.log("✓ Backup integrity verified");

    const sizeBytes = stats.size;
    console.log(
      `✓ Backup created successfully: ${(sizeBytes / 1024 / 1024).toFixed(2)}MB`
    );

    let remotePath = null;

    if (ftpConfig && ftpConfig.host) {
      console.log("Uploading to FTP...");

      try {
        const fileUrl = await uploadSingleFileToFTP(
          localPath,
          fileName,
          ftpConfig
        );

        remotePath = fileUrl;

        console.log(`✓ Uploaded to FTP: ${remotePath}`);

        // Remove local file after successful upload
        try {
          await fs.unlink(localPath);
          console.log(`✓ Removed local temp file`);
        } catch (unlinkErr) {
          console.warn(
            `Warning: Could not delete temp file: ${unlinkErr.message}`
          );
        }
      } catch (ftpErr) {
        console.error("❌ FTP upload failed:");
        console.error("Error:", ftpErr);

        const errorMessage =
          ftpErr?.message || ftpErr?.toString() || "Unknown FTP error";
        throw new Error(`FTP upload failed: ${errorMessage}`);
      }
    } else {
      console.warn("⚠️  FTP not configured - backup stored locally only");
      remotePath = localPath;
    }

    return {
      fileName,
      remotePath,
      sizeBytes,
      localPath: remotePath === localPath ? localPath : null,
      timestamp: timeStamp,
    };
  } catch (err) {
    console.error("Backup failed:");
    console.error("Error:", err);

    // Cleanup on failure
    try {
      if (fsSync.existsSync(localPath)) {
        await fs.unlink(localPath);
      }
    } catch (_) {}

    const errorMessage =
      err?.message || err?.toString() || "Unknown backup error";
    throw new Error(`Database backup failed: ${errorMessage}`);
  }
}

async function createBackupWithSpawn(dbConfig, outputPath) {
  return new Promise((resolve, reject) => {
    console.log("Starting pg_dump process...");

    const connectionString = `postgresql://${dbConfig.user}:${
      dbConfig.password
    }@${dbConfig.host}:${dbConfig.port || 5432}/${dbConfig.database}`;

    const pgDumpPath = getPgCommand("pg_dump");

    console.log(`Using pg_dump at: ${pgDumpPath}`);

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
        env: {
          ...process.env,
          PGPASSWORD: dbConfig.password || "",
        },
        shell: IS_WINDOWS,
      }
    );

    const gzip = zlib.createGzip({ level: 9 });
    const writeStream = fsSync.createWriteStream(outputPath);

    let hasError = false;
    let errorMessage = "";
    let stderrData = "";
    let pgDumpExited = false;
    let gzipEnded = false;
    let writeStreamFinished = false;

    // Pipe: pg_dump -> gzip -> file
    pgDump.stdout.pipe(gzip).pipe(writeStream);

    pgDump.stderr.on("data", (data) => {
      const message = data.toString();
      stderrData += message;

      // Only treat actual errors as errors (pg_dump outputs progress to stderr)
      if (
        message.toLowerCase().includes("error") &&
        !message.toLowerCase().includes("password")
      ) {
        console.error(`pg_dump error: ${message}`);
        errorMessage += message;
      }
    });

    pgDump.on("error", (error) => {
      if (hasError) return;
      hasError = true;
      reject(
        new Error(
          `Failed to spawn pg_dump: ${error.message}. Check PG_BIN_PATH in .env`
        )
      );
    });

    pgDump.on("close", (code) => {
      pgDumpExited = true;
      console.log(`pg_dump process exited with code: ${code}`);

      if (code !== 0) {
        if (hasError) return;
        hasError = true;
        const errorMsg =
          errorMessage || stderrData || `pg_dump exited with code ${code}`;
        reject(new Error(`pg_dump failed: ${errorMsg}`));
      }

      checkIfComplete();
    });

    gzip.on("end", () => {
      gzipEnded = true;
      console.log(`gzip compression ended`);
      checkIfComplete();
    });

    gzip.on("error", (error) => {
      if (hasError) return;
      hasError = true;
      reject(new Error(`Gzip compression error: ${error.message}`));
    });

    writeStream.on("finish", () => {
      writeStreamFinished = true;
      console.log(`Write stream finished`);
      checkIfComplete();
    });

    writeStream.on("error", (error) => {
      if (hasError) return;
      hasError = true;
      reject(new Error(`Write stream error: ${error.message}`));
    });

    function checkIfComplete() {
      // Only resolve when ALL operations are complete
      if (pgDumpExited && gzipEnded && writeStreamFinished && !hasError) {
        console.log(`✓ All backup streams completed successfully`);

        // Add extra delay to ensure file is fully flushed to disk
        setTimeout(() => {
          resolve();
        }, 500);
      }
    }
  });
}

async function verifyGzipFile(filePath) {
  return new Promise((resolve, reject) => {
    console.log("Verifying gzip file...");

    const gunzip = zlib.createGunzip();
    const readStream = fsSync.createReadStream(filePath);

    let bytesRead = 0;
    let hasData = false;

    gunzip.on("data", (chunk) => {
      hasData = true;
      bytesRead += chunk.length;
    });

    gunzip.on("end", () => {
      console.log(
        `✓ Decompressed ${(bytesRead / 1024 / 1024).toFixed(2)}MB successfully`
      );

      if (hasData && bytesRead > 0) {
        resolve();
      } else {
        reject(new Error("Backup file is empty after decompression"));
      }
    });

    gunzip.on("error", (err) => {
      console.error("Gzip verification failed:", err.message);
      reject(new Error(`Invalid gzip file: ${err.message}`));
    });

    readStream.on("error", (err) => {
      console.error("Read stream error:", err.message);
      reject(new Error(`Cannot read backup file: ${err.message}`));
    });

    readStream.pipe(gunzip);
  });
}

module.exports = { backupAndPushToFTP };
