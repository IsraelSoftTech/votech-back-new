const { Server } = require("socket.io");
const jwt = require("jsonwebtoken");

let io = null;

/**
 * Initialize Socket.IO server
 * @param {http.Server} server - HTTP server instance
 * @returns {Server} Socket.IO server instance
 */
function initializeSocket(server) {
  const allowedOrigins = [
    "https://votechs7academygroup.com",
    "https://www.votechs7academygroup.com",
    "https://votech-latest-front.onrender.com",
    "http://localhost:3000",
    "http://localhost:3004",
    "http://192.168.1.201:3000",
    "http://192.168.1.200:3000",
    "http://192.168.1.202:3000",
    "http://192.168.1.10:3000",
    "http://localhost:5173",
    "http://192.168.0.100:3000",
  ];

  io = new Server(server, {
    cors: {
      origin: allowedOrigins,
      methods: ["GET", "POST"],
      credentials: true,
    },
    transports: ["websocket", "polling"],
  });

  // Authentication middleware for Socket.IO
  io.use((socket, next) => {
    const token = socket.handshake.auth.token || socket.handshake.headers.authorization?.replace("Bearer ", "");
    
    if (!token) {
      return next(new Error("Authentication error: No token provided"));
    }

    try {
      const decoded = jwt.verify(token, process.env.JWT_SECRET || "your-secret-key");
      socket.userId = decoded.id;
      socket.userRole = decoded.role;
      next();
    } catch (err) {
      next(new Error("Authentication error: Invalid token"));
    }
  });

  io.on("connection", (socket) => {
    console.log(`✅ WebSocket client connected: ${socket.userId} (${socket.userRole})`);
    
    // Join user-specific room for targeted updates
    socket.join(`user:${socket.userId}`);

    socket.on("disconnect", () => {
      console.log(`❌ WebSocket client disconnected: ${socket.userId}`);
    });

    socket.on("error", (error) => {
      console.error(`❌ WebSocket error for user ${socket.userId}:`, error);
    });
  });

  console.log("✅ Socket.IO server initialized");
  return io;
}

/**
 * Get Socket.IO instance
 * @returns {Server} Socket.IO server instance
 */
function getIO() {
  if (!io) {
    throw new Error("Socket.IO not initialized. Call initializeSocket() first.");
  }
  return io;
}

/**
 * Emit event to specific user
 * @param {number} userId - User ID
 * @param {string} event - Event name
 * @param {any} data - Event data
 */
function emitToUser(userId, event, data) {
  if (!io) return;
  io.to(`user:${userId}`).emit(event, data);
}

/**
 * Emit event to all connected clients
 * @param {string} event - Event name
 * @param {any} data - Event data
 */
function emitToAll(event, data) {
  if (!io) return;
  io.emit(event, data);
}

/**
 * Emit unread message count update
 * @param {number} userId - User ID
 * @param {number} count - Unread count
 */
function emitUnreadCountUpdate(userId, count) {
  emitToUser(userId, "unreadCountUpdate", { count });
}

/**
 * Emit events count update
 * @param {number} count - Events count
 */
function emitEventsCountUpdate(count) {
  emitToAll("eventsCountUpdate", { count });
}

/**
 * Emit payslip count update
 * @param {number} userId - User ID
 * @param {number} count - Payslip count
 */
function emitPayslipCountUpdate(userId, count) {
  emitToUser(userId, "payslipCountUpdate", { count });
}

module.exports = {
  initializeSocket,
  getIO,
  emitToUser,
  emitToAll,
  emitUnreadCountUpdate,
  emitEventsCountUpdate,
  emitPayslipCountUpdate,
};

