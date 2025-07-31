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
      
      const tempFilePath = path.join(tempDir, fileName);
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