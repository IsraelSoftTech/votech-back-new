const ftp = require('basic-ftp');
const path = require('path');
const fs = require('fs');

class FTPService {
  constructor() {
    this.client = new ftp.Client();
    this.client.ftp.verbose = false;
    this.client.ftp.timeout = 30000;
    this.host = process.env.FTP_HOST || 'st60307.ispot.cc';
    this.user = process.env.FTP_USER || 'votechs7academygroup@st60307.ispot.cc';
    this.password = process.env.FTP_PASS || 'votechs7academygroup2025';
    this.secure = (process.env.FTP_SECURE || 'true').toLowerCase() === 'true';
    this.publicBaseUrl = process.env.FTP_PUBLIC_BASE_URL || 'https://st60307.ispot.cc/votechs7academygroup';
  }

  async uploadFile(localFilePath, remoteFileName, retryCount = 0) {
    const maxRetries = 3;
    let client = null;
    try {
      console.log(`[FTP] Starting upload (attempt ${retryCount + 1}/${maxRetries + 1}): ${localFilePath} -> ${remoteFileName}`);
      client = new ftp.Client();
      client.ftp.verbose = false;
      client.ftp.timeout = 30000;
      await client.access({
        host: this.host,
        user: this.user,
        password: this.password,
        secure: this.secure,
        secureOptions: { rejectUnauthorized: false }
      });
      console.log(`[FTP] Connected successfully to ${this.host}`);
      
      // Create directories if needed
      const remotePathParts = remoteFileName.split('/');
      if (remotePathParts.length > 1) {
        const directoryPath = remotePathParts.slice(0, -1).join('/');
        console.log(`[FTP] Creating directory: ${directoryPath}`);
        try {
          // Try to create the full directory path
          await client.ensureDir(directoryPath);
          console.log(`[FTP] Directory created/verified: ${directoryPath}`);
        } catch (dirError) {
          console.log(`[FTP] Directory creation failed, trying step by step: ${dirError.message}`);
          // Fallback: create directories one by one
          let currentPath = '';
          for (const part of remotePathParts.slice(0, -1)) {
            currentPath = currentPath ? `${currentPath}/${part}` : part;
            try {
              await client.send(`MKD ${currentPath}`);
              console.log(`[FTP] Created directory: ${currentPath}`);
            } catch (mkdirError) {
              // Directory might already exist, continue
              console.log(`[FTP] Directory ${currentPath} might already exist: ${mkdirError.message}`);
            }
          }
        }
      }
      
      await client.uploadFrom(localFilePath, remoteFileName);
      const publicUrl = `${this.publicBaseUrl.replace(/\/$/, '')}/${remoteFileName}`;
      console.log(`[FTP] File uploaded successfully. Public URL: ${publicUrl}`);
      return publicUrl;
    } catch (error) {
      console.error(`[FTP] Upload error (attempt ${retryCount + 1}):`, error.message);
      const isRetryableError = error.message.includes('ECONNRESET') || 
                              error.message.includes('ETIMEDOUT') ||
                              error.message.includes('ENOTFOUND') ||
                              error.message.includes('connection') ||
                              error.message.includes('timeout') ||
                              error.message.includes('550') ||
                              error.message.includes('No such file or directory');
      if (isRetryableError && retryCount < maxRetries) {
        console.log(`[FTP] Retrying upload in 2 seconds...`);
        await new Promise(resolve => setTimeout(resolve, 2000));
        return this.uploadFile(localFilePath, remoteFileName, retryCount + 1);
      }
      throw new Error(`Failed to upload file to FTP after ${retryCount + 1} attempts: ${error.message}`);
    } finally {
      try { if (client) client.close(); } catch {}
    }
  }

  async uploadBuffer(buffer, fileName, retryCount = 0) {
    const maxRetries = 3;
    try {
      console.log(`[FTP] Starting buffer upload (attempt ${retryCount + 1}/${maxRetries + 1}): ${fileName}`);
      const tempDir = path.join(__dirname, 'temp');
      if (!fs.existsSync(tempDir)) {
        fs.mkdirSync(tempDir, { recursive: true });
      }
      const fileNameParts = fileName.split('/');
      const fileNameOnly = fileNameParts.pop();
      const nestedDirs = fileNameParts.join('/');
      let tempFilePath;
      if (nestedDirs) {
        const nestedTempDir = path.join(tempDir, nestedDirs);
        if (!fs.existsSync(nestedTempDir)) {
          fs.mkdirSync(nestedTempDir, { recursive: true });
        }
        tempFilePath = path.join(nestedTempDir, fileNameOnly);
      } else {
        tempFilePath = path.join(tempDir, fileNameOnly);
      }
      fs.writeFileSync(tempFilePath, buffer);
      
      // Ensure the remote directory exists before uploading
      if (nestedDirs) {
        await this.ensureRemoteDirectory(nestedDirs);
      }
      
      const publicUrl = await this.uploadFile(tempFilePath, fileName);
      try { fs.unlinkSync(tempFilePath); } catch {}
      return publicUrl;
    } catch (error) {
      console.error(`[FTP] Buffer upload error (attempt ${retryCount + 1}):`, error.message);
      const isRetryableError = error.message.includes('ECONNRESET') || 
                              error.message.includes('ETIMEDOUT') ||
                              error.message.includes('ENOTFOUND') ||
                              error.message.includes('connection') ||
                              error.message.includes('timeout') ||
                              error.message.includes('550') ||
                              error.message.includes('No such file or directory');
      if (isRetryableError && retryCount < maxRetries) {
        console.log(`[FTP] Retrying buffer upload in 2 seconds...`);
        await new Promise(resolve => setTimeout(resolve, 2000));
        return this.uploadBuffer(buffer, fileName, retryCount + 1);
      }
      throw new Error(`Failed to upload buffer to FTP after ${retryCount + 1} attempts: ${error.message}`);
    }
  }

  async ensureRemoteDirectory(directoryPath) {
    let client = null;
    try {
      console.log(`[FTP] Ensuring remote directory exists: ${directoryPath}`);
      client = new ftp.Client();
      client.ftp.verbose = false;
      client.ftp.timeout = 30000;
      await client.access({
        host: this.host,
        user: this.user,
        password: this.password,
        secure: this.secure,
        secureOptions: { rejectUnauthorized: false }
      });
      
      const pathParts = directoryPath.split('/');
      let currentPath = '';
      for (const part of pathParts) {
        currentPath = currentPath ? `${currentPath}/${part}` : part;
        try {
          await client.send(`MKD ${currentPath}`);
          console.log(`[FTP] Created directory: ${currentPath}`);
        } catch (mkdirError) {
          // Directory might already exist, which is fine
          console.log(`[FTP] Directory ${currentPath} already exists or creation failed: ${mkdirError.message}`);
        }
      }
    } catch (error) {
      console.error(`[FTP] Error ensuring remote directory: ${error.message}`);
      throw error;
    } finally {
      try { if (client) client.close(); } catch {}
    }
  }

  async deleteFile(fileName) {
    try {
      await this.client.access({
        host: this.host,
        user: this.user,
        password: this.password,
        secure: this.secure,
        secureOptions: { rejectUnauthorized: false }
      });
      await this.client.remove(fileName);
    } catch (error) {
      console.error('FTP delete error:', error);
    } finally {
      this.client.close();
    }
  }
}

module.exports = new FTPService(); 