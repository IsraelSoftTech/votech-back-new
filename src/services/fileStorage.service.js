const Client = require("ftp");
const fs = require("fs");
const path = require("path");
const https = require("https");
const os = require("os");
const { v4: uuidv4 } = require("uuid");
const AppError = require("../utils/AppError");
const { StatusCodes } = require("http-status-codes");
const dotenv = require("dotenv");
dotenv.config();

// Config based on environment variables
const DEV_UPLOAD_DIR =
  process.env.DEV_UPLOAD_DIR || path.join(__dirname, "../../local_uploads");
const DEV_BASE_URL =
  process.env.DEV_BASE_URL || "http://localhost:5000/uploads";

// Ensure local upload directory exists
fs.mkdirSync(DEV_UPLOAD_DIR, { recursive: true });

const TEMP_DIR = process.env.TEMP_DIR || path.join(os.tmpdir(), "ftp-uploads");
fs.mkdirSync(TEMP_DIR, { recursive: true });

const NODE_ENV = process.env.NODE_ENV || "development";
const isProduction = NODE_ENV === "production";

// In real production we require full FTP config; in dev/desktop we fall back to local storage
if (isProduction) {
  if (
    !process.env.FTP_USER ||
    !process.env.FTP_PASS ||
    !process.env.FTP_HOST ||
    !process.env.FTP_PORT ||
    !process.env.FTP_UPLOAD_DIR ||
    !process.env.FTP_BASE_URL
  ) {
    throw new Error("Invalid FTP Server configuration");
  }
} else {
  console.warn(
    "FTP configuration is incomplete or NODE_ENV is not 'production'. Using local file storage instead of FTP."
  );
}

const config = {
  user: process.env.FTP_USER || "",
  password: process.env.FTP_PASS || "",
  host: process.env.FTP_HOST || "",
  port: Number(process.env.FTP_PORT) || 21,
  remoteDir: process.env.FTP_UPLOAD_DIR || "/",
  remoteUrlBase: process.env.FTP_BASE_URL || "",
};

// Ensure remote FTP directory exists. This used to pre-check each path
// segment with client.list() and only mkdir on error, but this FTP server
// (st60307.ispot.cc) returns an empty list with NO error for a directory
// that doesn't exist yet, instead of an ENOENT-style error — so that check
// always concluded "already exists" and silently skipped the real mkdir,
// which is exactly what was making every report-card upload fail with
// "Can't open that file: No such file or directory" (confirmed directly
// against the live server, see scripts/debugFtpMkdir.js). mkdir(dir, true)
// (recursive) is a no-op error-free call when the directory already
// exists on this server too, so just always call it — no existence check
// needed at all.
function ensureRemoteDir(client, dir) {
  return new Promise((resolve, reject) => {
    console.log(`Ensuring directory exists: ${dir}`);
    client.mkdir(dir, true, (err) => {
      if (err) return reject(err);
      resolve();
    });
  });
}

// Test if uploaded file is available via HTTP
function verifyWebAccess(url) {
  return new Promise((resolve, reject) => {
    https
      .get(url, (res) => {
        if (res.statusCode === 200) {
          console.log("✅ File is accessible via web:", url);
          resolve();
        } else {
          reject(
            new Error(
              `❌ File not accessible via web, status code: ${res.statusCode}`
            )
          );
        }
      })
      .on("error", (err) => {
        reject(new Error(`❌ Error accessing web URL: ${err.message}`));
      });
  });
}

// Verify file exists on FTP server
function verifyFile(client, remoteDir, remoteFile) {
  return new Promise((resolve, reject) => {
    const remotePath = path.posix
      .join(remoteDir, remoteFile)
      .split(" ")
      .join("");

    client.list(remoteDir, (err, list) => {
      if (err) {
        console.error("❌ Error listing directory contents:", err);
        return reject(err);
      }

      const fileFound = list.some((file) => file.name === remoteFile);
      if (fileFound) {
        console.log("✅ File verified on server:", remotePath);
        resolve();
      } else {
        console.error(`❌ File not found on server: ${remotePath}`);
        reject(new Error(`File not found on server: ${remotePath}`));
      }
    });
  });
}

// Upload file to FTP
async function uploadToFTP(localFilePath, remoteFileName) {
  const client = new Client();
  const remotePath = path.posix
    .join(config.remoteDir, remoteFileName)
    .split(" ")
    .join("");

  const fileUrl = (config.remoteDir.replace("/", "") + remoteFileName)
    .split(" ")
    .join("");

  return new Promise((resolve, reject) => {
    client.connect({
      host: config.host,
      user: config.user,
      password: config.password,
      port: config.port,
    });

    console.log("FTP server connected✅✅");

    client.on("ready", async () => {
      try {
        await ensureRemoteDir(client, config.remoteDir);

        const rs = fs.createReadStream(localFilePath);
        await new Promise((res, rej) => {
          client.put(rs, remotePath, (err) => (err ? rej(err) : res()));
        });

        await new Promise((res, rej) => {
          client.site(`CHMOD 644 ${remotePath}`, (err) =>
            err ? rej(err) : res()
          );
        });

        console.log(`File URL: ${config.remoteUrlBase + fileUrl}`);

        await verifyFile(client, config.remoteDir, remoteFileName);

        try {
          await verifyWebAccess(config.remoteUrlBase + fileUrl);
        } catch (webErr) {
          console.warn("Web verification failed (ignoring):", webErr.message);
        }

        resolve(`${fileUrl}`);
      } catch (err) {
        reject(err);
      } finally {
        client.end();
      }
    });

    client.on("error", reject);
  });
}

// Production upload handler
async function handleFileUploadsProduction(request) {
  const fileUrls = [];
  const tempFiles = [];

  try {
    if (!request.files || request.files.length === 0) {
      throw new Error("No files provided in the request");
    }

    for (const file of request.files) {
      const uniqueFileName = `${uuidv4()}-${file.originalname}`;
      const tempFilePath = path.join(TEMP_DIR, uniqueFileName);

      await new Promise((res, rej) => {
        fs.rename(file.path, tempFilePath, (err) => (err ? rej(err) : res()));
      });

      console.log("Moved file to temp dir:", tempFilePath);
      tempFiles.push(tempFilePath);

      const fileUrl = await uploadToFTP(tempFilePath, uniqueFileName);
      console.log("Final URL (relative):", fileUrl);

      fileUrls.push(fileUrl);
    }

    return fileUrls;
  } finally {
    for (const tempFile of tempFiles) {
      try {
        fs.unlinkSync(tempFile);
        console.log(`Deleted temporary file: ${tempFile}`);
      } catch (err) {
        console.error(`Failed to delete temporary file ${tempFile}:`, err);
      }
    }
  }
}

// Development upload handler
async function handleFileUploadsDevelopment(request) {
  const fileUrls = [];

  if (!request.files || request.files.length === 0) {
    throw new AppError("No files provided", StatusCodes.BAD_REQUEST);
  }

  for (const file of request.files) {
    const uniqueFileName = `${uuidv4()}-${file.originalname}`;
    const destPath = path.join(DEV_UPLOAD_DIR, uniqueFileName);

    await fs.promises.rename(file.path, destPath);

    const fileUrl = `${DEV_BASE_URL}/${uniqueFileName}`.split(" ").join("");
    fileUrls.push(fileUrl);
  }

  return fileUrls;
}

// Replace file in development
async function replaceFileDevelopment(oldFileUrl, request) {
  if (!oldFileUrl)
    throw new AppError("Old file URL required", StatusCodes.BAD_REQUEST);
  if (!request.files || request.files.length === 0)
    throw new AppError("No new file provided", StatusCodes.BAD_REQUEST);

  try {
    const oldFileName = path.basename(oldFileUrl);
    const oldFilePath = path.join(DEV_UPLOAD_DIR, oldFileName);

    if (fs.existsSync(oldFilePath)) {
      await fs.promises.unlink(oldFilePath);
    }
  } catch {}

  const newUrls = await handleFileUploadsDevelopment(request);
  return newUrls[0];
}

// Delete files in development
async function deleteFilesDevelopment(urls) {
  if (!urls || urls.length === 0)
    throw new AppError("No file URLs provided", StatusCodes.BAD_REQUEST);

  for (const fileUrl of urls) {
    const fileName = path.basename(fileUrl);
    const filePath = path.join(DEV_UPLOAD_DIR, fileName);

    if (fs.existsSync(filePath)) {
      await fs.promises.unlink(filePath);
    }
  }
}

// Replace file in production
async function replaceFileProduction(oldUrl, request) {
  if (!oldUrl)
    throw new AppError("Old file URL required", StatusCodes.BAD_REQUEST);
  if (!request.files || request.files.length === 0)
    throw new AppError("No new file provided", StatusCodes.BAD_REQUEST);

  const file = request.files[0];
  const uniqueFileName = `${uuidv4()}-${file.originalname}`;
  const tempFilePath = path.join(TEMP_DIR, uniqueFileName);

  await fs.promises.rename(file.path, tempFilePath);

  try {
    const newFileUrl = await uploadToFTP(tempFilePath, uniqueFileName);

    const oldFileName = path.basename(oldUrl);
    const client = new Client();

    await new Promise((resolve, reject) => {
      client.on("ready", () => {
        client.delete(path.posix.join(config.remoteDir, oldFileName), (err) => {
          client.end();
          if (err) return reject(err);
          resolve();
        });
      });

      client.on("error", reject);

      client.connect({
        host: config.host,
        port: config.port,
        user: config.user,
        password: config.password,
      });
    });

    return newFileUrl;
  } finally {
    try {
      await fs.promises.unlink(tempFilePath);
    } catch {}
  }
}

// Delete files from FTP
function deleteFilesFromFTP(urls) {
  return new Promise((resolve, reject) => {
    const client = new Client();

    client.on("ready", () => {
      const filesToDelete = [];

      for (const fileUrl of urls) {
        if (!fileUrl.startsWith(config.remoteUrlBase)) {
          client.end();
          return reject(
            new AppError(
              `URL does not match FTP base URL: ${fileUrl}`,
              StatusCodes.BAD_REQUEST
            )
          );
        }

        const relativePath = fileUrl.replace(config.remoteUrlBase, "");
        const remotePath = path.posix.join("", relativePath);
        filesToDelete.push(remotePath);
      }

      const deleteNext = () => {
        if (filesToDelete.length === 0) {
          client.end();
          return resolve();
        }

        const currentFile = filesToDelete.shift();
        if (!currentFile) return deleteNext();

        client.delete(currentFile, (err) => {
          if (err) {
            client.end();
            return reject(
              new AppError(
                `Failed to delete file from FTP: ${currentFile}`,
                StatusCodes.INTERNAL_SERVER_ERROR
              )
            );
          }

          console.log(`✅ Deleted: ${currentFile}`);
          deleteNext();
        });
      };

      deleteNext();
    });

    client.on("error", (err) => {
      reject(
        new AppError(
          `FTP client error: ${err.message}`,
          StatusCodes.BAD_GATEWAY
        )
      );
    });

    client.connect({
      host: config.host,
      port: config.port,
      user: config.user,
      password: config.password,
    });
  });
}

// General upload handler
async function handleFileUploads(req, maxSizePerFileInMB, allowedExtensions) {
  const maxSizeBytes = maxSizePerFileInMB * 1024 * 1024;

  if (!req.files || !Array.isArray(req.files)) {
    throw new AppError(
      "No files detected in the Request object",
      StatusCodes.BAD_REQUEST
    );
  }

  for (const file of req.files) {
    const ext = path.extname(file.originalname).toLowerCase();

    if (!allowedExtensions.includes(ext)) {
      throw new AppError(
        `Invalid file type: ${ext}. Allowed extensions are: ${allowedExtensions.join(
          ", "
        )}`,
        StatusCodes.BAD_REQUEST
      );
    }

    if (file.size > maxSizeBytes) {
      throw new AppError(
        `File too large: ${file.originalname} exceeds the limit of ${maxSizePerFileInMB} MB`,
        StatusCodes.BAD_REQUEST
      );
    }
  }

  // Use FTP only in true production; otherwise use local development storage
  return NODE_ENV === "production"
    ? handleFileUploadsProduction(req)
    : handleFileUploadsDevelopment(req);
}

// The "ftp" package only times out the initial connect/PASV handshake, not a
// stalled data transfer (a half-open TCP connection just sits there). That's
// what left report card runs stuck "running" forever: the whole session
// executor is a bare `await` on this promise, so if it never settles, the
// run's status never changes, the lock never releases, and no failure
// notification ever fires. A hard watchdog guarantees this always settles
// one way or another, same principle as the desktop sync handler's 30s
// batch-ack timeout (sync.handler.js) — never await a network op unbounded.
const FTP_UPLOAD_TIMEOUT_MS = Number(process.env.FTP_UPLOAD_TIMEOUT_MS) || 5 * 60 * 1000;

async function uploadSingleFileToFTP(localFilePath, remoteFileName, ftpConfig) {
  return new Promise((resolve, reject) => {
    console.log(`\n=== FTP Upload Details ===`);
    console.log(`Local file: ${localFilePath}`);
    console.log(`Remote name: ${remoteFileName}`);
    console.log(`FTP host: ${ftpConfig.host}:${ftpConfig.port}`);
    console.log(`FTP user: ${ftpConfig.user}`);
    console.log(`Remote dir: ${ftpConfig.remoteDir || "/"}`);
    console.log(`========================\n`);

    // Verify local file exists
    if (!fs.existsSync(localFilePath)) {
      return reject(new Error(`Local file does not exist: ${localFilePath}`));
    }

    const client = new Client();

    let settled = false;
    const settle = (fn, arg) => {
      if (settled) return;
      settled = true;
      clearTimeout(watchdog);
      fn(arg);
    };

    const watchdog = setTimeout(() => {
      console.error(
        `❌ FTP upload watchdog fired after ${FTP_UPLOAD_TIMEOUT_MS}ms — connection or transfer stalled, forcing it closed`
      );
      try {
        client.end();
      } catch (endErr) {
        // Best-effort, the connection is already unresponsive.
      }
      settle(reject, new Error(`FTP upload timed out after ${FTP_UPLOAD_TIMEOUT_MS}ms`));
    }, FTP_UPLOAD_TIMEOUT_MS);

    const remoteDir = ftpConfig.remoteDir || config.remoteDir || "/";
    const remotePath = path.posix
      .join(remoteDir, remoteFileName)
      .split(" ")
      .join("");
    // remotePath is already an absolute, correctly-joined path (leading
    // "/"), so baseUrl (no trailing slash) + remotePath is a clean join —
    // the old (remoteDir.replace("/", "") + remoteFileName) construction
    // dropped the separating slash whenever remoteDir was just "/",
    // producing URLs like ".../votechs7academygroupreport-cards/..." with
    // the two path segments jammed together.
    const fileUrl = remotePath;
    const baseUrl = ftpConfig.remoteUrlBase || config.remoteUrlBase || "";

    let uploadStarted = false;

    client.on("ready", async () => {
      console.log("✓ FTP connection established");

      try {
        // Ensure remote directory exists. remoteFileName can itself carry a
        // subdirectory prefix (e.g. "report-cards/session-1-class-2.pdf"),
        // so the directory that actually needs to exist is remotePath's own
        // parent, not just the configured base remoteDir — creating only
        // the base and then PUTting into a missing subdirectory is exactly
        // what was making report card uploads fail.
        await ensureRemoteDir(client, path.posix.dirname(remotePath));

        console.log(`Uploading to: ${remotePath}`);

        const readStream = fs.createReadStream(localFilePath);

        readStream.on("error", (err) => {
          console.error("Read stream error:", err);
          client.end();
          if (!uploadStarted) {
            settle(reject, new Error(`Failed to read file: ${err.message}`));
          }
        });

        client.put(readStream, remotePath, (err) => {
          uploadStarted = true;

          if (err) {
            console.error("❌ FTP PUT error:", err);
            client.end();
            return settle(reject, new Error(`FTP PUT failed: ${err.message}`));
          }

          console.log("✓ File uploaded successfully");

          // Try to set permissions (non-critical)
          client.site(`CHMOD 644 ${remotePath}`, (chmodErr) => {
            if (chmodErr) {
              console.warn("CHMOD failed (non-critical):", chmodErr.message);
            } else {
              console.log("✓ File permissions set");
            }

            // Verify file exists. remoteFileName may carry a subdirectory
            // prefix, list() only returns basenames within the listed
            // directory, so both the listed dir and the comparison target
            // must be the file's own parent dir / basename, not the
            // possibly-different configured base remoteDir.
            const uploadDir = path.posix.dirname(remotePath);
            const uploadBasename = path.posix.basename(remoteFileName);
            client.list(uploadDir, (listErr, list) => {
              client.end();

              if (listErr) {
                console.warn(
                  "Could not verify file (ignoring):",
                  listErr.message
                );
                return settle(resolve, `${baseUrl}${fileUrl}`);
              }

              const fileFound = list.some(
                (file) => file.name === uploadBasename
              );
              if (fileFound) {
                console.log("✓ File verified on server");
                console.log(`✓ File URL: ${baseUrl}${fileUrl}`);
                settle(resolve, `${baseUrl}${fileUrl}`);
              } else {
                console.warn("Warning: File not found in directory listing");
                settle(resolve, `${baseUrl}${fileUrl}`); // Return anyway, might be permission issue
              }
            });
          });
        });
      } catch (err) {
        console.error("❌ FTP operation error:", err);
        client.end();
        settle(reject, new Error(`FTP operation failed: ${err.message}`));
      }
    });

    client.on("error", (err) => {
      console.error("❌ FTP client error:", err);
      settle(reject, new Error(`FTP connection failed: ${err.message}`));
    });

    console.log("Connecting to FTP server...");

    try {
      client.connect({
        host: ftpConfig.host || config.host,
        port: ftpConfig.port || config.port || 21,
        user: ftpConfig.user || config.user,
        password: ftpConfig.password || config.password,
        connTimeout: 15000,
        pasvTimeout: 15000,
        keepalive: 10000,
      });
    } catch (connectErr) {
      console.error("❌ FTP connect error:", connectErr);
      settle(reject, new Error(`FTP connect failed: ${connectErr.message}`));
    }
  });
}

// Export all functions
module.exports = {
  handleFileUploads,
  handleFileUploadsDevelopment,
  replaceFileDevelopment,
  deleteFilesDevelopment,
  replaceFileProduction,
  deleteFilesFromFTP,
  uploadSingleFileToFTP,
};
