process.on("uncaughtException", (err) => {
  console.error("Uncaught Exception:", err);
});
process.on("unhandledRejection", (reason) => {
  console.error("Unhandled Rejection:", reason);
});

require("dotenv").config();
const app = require("./app");

const basePort = parseInt(process.env.PORT || "5000", 10);

// Best-effort port cleanup, then single bind attempt
const { exec } = require('child_process');
exec(process.platform === 'win32' ? `for /f "tokens=5" %a in ('netstat -ano ^| findstr :${basePort} ^| findstr LISTENING') do taskkill /F /PID %a` : `lsof -ti tcp:${basePort} | xargs kill -9`, () => {});

function startOnce(port) {
  const server = app.listen(port, "0.0.0.0", () => {
    console.log(`Server running on port ${port}`);
  });
  server.on("error", (err) => {
    if (err && err.code === "EADDRINUSE") {
      console.error(`Failed to bind to port ${port}: address in use`);
    } else {
      console.error("Failed to start server:", err);
    }
    process.exit(1);
  });
}

startOnce(basePort);

console.log("🚀 Starting Votech Backend Server...");
console.log("📊 Database: PostgreSQL");
console.log("🔐 Authentication: JWT");
console.log("📁 File Storage: FTP + Local");

 
