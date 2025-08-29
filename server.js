process.on("uncaughtException", (err) => {
  console.error("Uncaught Exception:", err);
});
process.on("unhandledRejection", (reason) => {
  console.error("Unhandled Rejection:", reason);
});

require("dotenv").config();
const app = require("./app");

const basePort = parseInt(process.env.PORT || "5000", 10);

// Kill any process using the port before starting (best-effort, non-blocking)
const { exec } = require('child_process');
exec(process.platform === 'win32' ? `for /f "tokens=5" %a in ('netstat -ano ^| findstr :${basePort} ^| findstr LISTENING') do taskkill /F /PID %a` : `lsof -ti tcp:${basePort} | xargs kill -9`, (err) => {
  if (err) {
    console.warn('Port cleanup warning:', err.message);
  } else {
    console.log(`Cleaned any processes on port ${basePort}`);
  }
});

async function startOnAvailablePort(startPort) {
  let port = startPort;
  for (let i = 0; i < 20; i++) {
    const started = await new Promise((resolve, reject) => {
      const server = app.listen(port, "0.0.0.0", () => resolve(server));
      server.on("error", (err) => {
        if (err && err.code === "EADDRINUSE") {
          resolve(null);
        } else {
          reject(err);
        }
      });
    });
    if (started) {
      console.log(`Server running on port ${port}`);
      return;
    }
    console.log(`Port ${port} in use. Trying ${port + 1}...`);
    port += 1;
  }
  console.error("Could not find a free port to start the server.");
}

startOnAvailablePort(basePort).catch((err) => {
  console.error("Failed to start server:", err);
});

console.log("🚀 Starting Votech Backend Server...");
console.log("📊 Database: PostgreSQL");
console.log("🔐 Authentication: JWT");
console.log("📁 File Storage: FTP + Local");

 
