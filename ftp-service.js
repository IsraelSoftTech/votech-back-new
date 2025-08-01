const ftp = require('basic-ftp');
const path = require('path');
const fs = require('fs');

class FTPService {
  constructor() {
    this.client = new ftp.Client();
    this.client.ftp.verbose = false; // Set to true for debugging
  }

  async uploadFile(localFilePath, remoteFileName) {
    try {
      console.log(`[FTP] Starting upload: ${localFilePath} -> ${remoteFileName}`);
      
      await this.client.access({
        host: 'st60307.ispot.cc',
        user: 'votechs7academygroup@st60307.ispot.cc',
        password: 'votechs7academygroup2025',
        secure: true,
        secureOptions: {
          rejectUnauthorized: false // Disable SSL certificate verification
        }
      });

      console.log(`[FTP] Connected successfully`);

      // Create directory structure if it doesn't exist
      const remotePathParts = remoteFileName.split('/');
      if (remotePathParts.length > 1) {
        const directoryPath = remotePathParts.slice(0, -1).join('/');
        console.log(`[FTP] Creating directory: ${directoryPath}`);
        try {
          await this.client.ensureDir(directoryPath);
          console.log(`[FTP] Directory created/verified: ${directoryPath}`);
        } catch (dirError) {
          console.log(`[FTP] Directory creation warning: ${dirError.message}`);
          // Continue anyway, the directory might already exist
        }
      }

      // Upload the file
      await this.client.uploadFrom(localFilePath, remoteFileName);
      
      console.log(`[FTP] File uploaded successfully`);
      
      // Return the public URL
      const publicUrl = `https://st60307.ispot.cc/votechs7academygroup/${remoteFileName}`;
      console.log(`[FTP] Public URL: ${publicUrl}`);
      
      return publicUrl;
    } catch (error) {
      console.error('[FTP] Upload error:', error);
      throw new Error(`Failed to upload file to FTP: ${error.message}`);
    } finally {
      this.client.close();
      console.log(`[FTP] Connection closed`);
    }
  }

  async uploadBuffer(buffer, fileName) {
    try {
      // Create a temporary file
      const tempDir = path.join(__dirname, 'temp');
      if (!fs.existsSync(tempDir)) {
        fs.mkdirSync(tempDir, { recursive: true });
      }
      
      // Handle nested directories in fileName
      const fileNameParts = fileName.split('/');
      const fileNameOnly = fileNameParts.pop(); // Get just the filename
      const nestedDirs = fileNameParts.join('/'); // Get the directory path
      
      let tempFilePath;
      if (nestedDirs) {
        // Create nested directory structure in temp
        const nestedTempDir = path.join(tempDir, nestedDirs);
        if (!fs.existsSync(nestedTempDir)) {
          fs.mkdirSync(nestedTempDir, { recursive: true });
        }
        tempFilePath = path.join(nestedTempDir, fileNameOnly);
      } else {
        tempFilePath = path.join(tempDir, fileNameOnly);
      }
      
      fs.writeFileSync(tempFilePath, buffer);

      // Upload to FTP
      const publicUrl = await this.uploadFile(tempFilePath, fileName);

      // Clean up temporary file
      fs.unlinkSync(tempFilePath);

      return publicUrl;
    } catch (error) {
      console.error('FTP buffer upload error:', error);
      throw new Error(`Failed to upload buffer to FTP: ${error.message}`);
    }
  }

  async deleteFile(fileName) {
    try {
      await this.client.access({
        host: 'st60307.ispot.cc',
        user: 'votechs7academygroup@st60307.ispot.cc',
        password: 'votechs7academygroup2025',
        secure: true,
        secureOptions: {
          rejectUnauthorized: false // Disable SSL certificate verification
        }
      });

      await this.client.remove(fileName);
    } catch (error) {
      console.error('FTP delete error:', error);
      // Don't throw error for delete operations as file might not exist
    } finally {
      this.client.close();
    }
  }
}

module.exports = new FTPService(); 