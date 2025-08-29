const ftp = require('basic-ftp');
const path = require('path');
const fs = require('fs');

class FTPService {
  constructor() {
    this.host = process.env.FTP_HOST || 'st60307.ispot.cc';
    this.user = process.env.FTP_USER || 'votechs7academygroup@st60307.ispot.cc';
    this.password = process.env.FTP_PASS || 'votechs7academygroup2025';
    this.secure = (process.env.FTP_SECURE || 'true').toLowerCase() === 'true';
    this.publicBaseUrl = process.env.FTP_PUBLIC_BASE_URL || 'https://st60307.ispot.cc/votechs7academygroup';
  }

  async uploadFile(localFilePath, remoteFileName, retryCount = 0) {
    const maxRetries = 2;
    
    let client = new ftp.Client();
    client.ftp.verbose = false;
    client.ftp.timeout = 30000;
    try {
      await client.access({
        host: this.host,
        user: this.user,
        password: this.password,
        secure: this.secure,
        secureOptions: { rejectUnauthorized: false }
      });

      // Ensure remote directory exists
      const directoryPath = path.dirname(remoteFileName);
      try {
        await client.ensureDir(directoryPath);
      } catch (dirError) {
        // Try creating directory step by step
        const pathParts = directoryPath.split('/').filter(part => part.length > 0);
        let currentPath = '';
        
        for (const part of pathParts) {
          currentPath += '/' + part;
          try {
            await client.ensureDir(currentPath);
          } catch (mkdirError) {
            // Directory might already exist
          }
        }
      }

      // After ensureDir, CWD is set; upload basename only
      await client.uploadFrom(localFilePath, path.basename(remoteFileName));
      
      // Generate public URL
      const publicUrl = `${this.publicBaseUrl.replace(/\/$/, '')}/${remoteFileName}`;
      return publicUrl;
      
    } catch (error) {
      if (retryCount < maxRetries) {
        // Wait 2 seconds before retrying
        await new Promise(resolve => setTimeout(resolve, 2000));
        return this.uploadFile(localFilePath, remoteFileName, retryCount + 1);
      }
      throw error;
    } finally {
      try { client.close(); } catch {}
    }
  }

  async uploadBuffer(buffer, fileName, retryCount = 0) {
    const maxRetries = 2;
    
    let client = new ftp.Client();
    client.ftp.verbose = false;
    client.ftp.timeout = 30000;
    try {
      await client.access({
        host: this.host,
        user: this.user,
        password: this.password,
        secure: this.secure,
        secureOptions: { rejectUnauthorized: false }
      });

      // Ensure remote directory exists
      const directoryPath = path.dirname(fileName);
      try {
        await client.ensureDir(directoryPath);
      } catch (dirError) {
        // Try creating directory step by step
        const pathParts = directoryPath.split('/').filter(part => part.length > 0);
        let currentPath = '';
        
        for (const part of pathParts) {
          currentPath += '/' + part;
          try {
            await client.ensureDir(currentPath);
          } catch (mkdirError) {
            // Directory might already exist
          }
        }
      }

      // Upload the buffer using a readable stream (upload basename only)
      const { Readable } = require('stream');
      const readStream = Readable.from(buffer);
      await client.uploadFrom(readStream, path.basename(fileName));
      
      // Generate public URL
      const publicUrl = `${this.publicBaseUrl.replace(/\/$/, '')}/${fileName}`;
      return publicUrl;
      
    } catch (error) {
      if (retryCount < maxRetries) {
        // Wait 2 seconds before retrying
        await new Promise(resolve => setTimeout(resolve, 2000));
        return this.uploadBuffer(buffer, fileName, retryCount + 1);
      }
      throw error;
    } finally {
      try { client.close(); } catch {}
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