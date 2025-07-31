const ftpService = require('./ftp-service');

async function testFTPConnection() {
  console.log('Testing FTP connection...\n');
  
  try {
    // Test with a simple text file
    const testContent = 'This is a test file for FTP upload';
    const testBuffer = Buffer.from(testContent, 'utf8');
    const filename = `test_${Date.now()}.txt`;
    
    console.log('Attempting to upload test file...');
    const result = await ftpService.uploadBuffer(testBuffer, filename);
    console.log('✅ FTP upload successful!');
    console.log('File URL:', result);
    
  } catch (error) {
    console.error('❌ FTP upload failed:', error.message);
    console.error('Full error:', error);
  }
}

testFTPConnection(); 