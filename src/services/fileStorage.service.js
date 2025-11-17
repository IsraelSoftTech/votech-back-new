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

const isProduction = process.env.NODE_ENV === "production";

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
}

const config = {
  user: process.env.FTP_USER || "",
  password: process.env.FTP_PASS || "",
  host: process.env.FTP_HOST || "",
  port: Number(process.env.FTP_PORT) || 21,
  remoteDir: process.env.FTP_UPLOAD_DIR || "/",
  remoteUrlBase: process.env.FTP_BASE_URL || "",
};

// Ensure remote FTP directory exists
function ensureRemoteDir(client, dir) {
  console.log(`Creating directory structure: ${dir}`);
  const parts = dir.split("/").filter(Boolean);

  return parts.reduce((promise, _, idx) => {
    const segment = "/" + parts.slice(0, idx + 1).join("/");
    return promise.then(
      () =>
        new Promise((res, rej) => {
          client.list(segment, (err) => {
            if (err) {
              console.log(`Creating directory: ${segment}`);
              client.mkdir(segment, true, (mkErr) =>
                mkErr ? rej(mkErr) : res()
              );
            } else {
              console.log(`Directory already exists: ${segment}`);
              res();
            }
          });
        })
    );
  }, Promise.resolve());
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

  return process.env.NODE_ENV === "desktop"
    ? handleFileUploadsDevelopment(req)
    : handleFileUploadsProduction(req);
}

// Export all functions
module.exports = {
  handleFileUploads,
  handleFileUploadsDevelopment,
  replaceFileDevelopment,
  deleteFilesDevelopment,
  replaceFileProduction,
  deleteFilesFromFTP,
};
