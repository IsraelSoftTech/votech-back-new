process.on('uncaughtException', (err) => {
  console.error('Uncaught Exception:', err);
});
process.on('unhandledRejection', (reason) => {
  console.error('Unhandled Rejection:', reason);
});

require('dotenv').config();
const app = require('./app');

const basePort = parseInt(process.env.PORT || '5000', 10);
const { exec } = require('child_process');

function killPort(port) {
  return new Promise((resolve) => {
    const cmd = process.platform === 'win32'
      ? `for /f "tokens=5" %a in ('netstat -ano ^| findstr :${port} ^| findstr LISTENING') do taskkill /F /PID %a`
      : `lsof -ti tcp:${port} | xargs kill -9`;
    exec(cmd, (err) => {
      if (err) console.warn(`Port ${port} cleanup warning:`, err.message);
      else console.log(`Cleaned any processes on port ${port}`);
      resolve();
    });
  });
}

async function startStrictOnPort(port) {
  await killPort(port);
  const server = app.listen(port, '0.0.0.0', () => {
    console.log(`Server running on port ${port}`);
  });
  server.on('error', async (err) => {
    if (err && err.code === 'EADDRINUSE') {
      console.warn(`Port ${port} still in use after cleanup. Retrying once...`);
      await killPort(port);
      setTimeout(() => {
        app.listen(port, '0.0.0.0', () => {
          console.log(`Server running on port ${port}`);
        }).on('error', (e2) => {
          console.error(`Failed to bind to port ${port}:`, e2.message);
          process.exit(1);
        });
      }, 500);
    } else {
      console.error('Failed to start server:', err);
      process.exit(1);
    }
  });
}

startStrictOnPort(basePort).catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});

console.log('🚀 Starting Votech Backend Server...');
console.log('📊 Database: PostgreSQL');
console.log('🔐 Authentication: JWT');
console.log('📁 File Storage: FTP + Local');


