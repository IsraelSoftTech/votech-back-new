process.on("uncaughtException", (err) => {
  console.error("Uncaught Exception:", err);
});

process.on("unhandledRejection", (reason, promise) => {
  console.error("Unhandled Rejection:", reason);
});

const express = require("express");
const cors = require("cors");
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const path = require("path");
const net = require("net");
const { exec } = require("child_process");
const util = require("util");
const multer = require("multer");
const XLSX = require("xlsx");
const execAsync = util.promisify(exec);
const { Pool } = require("pg");
const { Sequelize, DataTypes } = require("sequelize");
require("dotenv").config();

console.log("DATABASE_URL:", process.env.DATABASE_URL);
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
});

// Import all route modules
const authRoutes = require("./routes/auth");
const feesRoutes = require("./routes/fees");
const studentsRoutes = require("./routes/students");
const classesRoutes = require("./routes/classes");
const teachersRoutes = require("./routes/teachers");
const usersRoutes = require("./routes/users");
const messagesRoutes = require("./routes/messages");
const inventoryRoutes = require("./routes/inventory");
const subjectsRouter = require("./routes/subjects");
const lessonPlansRouter = require("./routes/lessonPlans");
const lessonsRouter = require("./routes/lessons");
const groupsRouter = require("./routes/groups");
const salaryRouter = require("./routes/salary");
const timetablesRouter = require("./routes/timetables");
const casesRouter = require("./routes/cases");
const createAttendanceRouter = require("./routes/attendance");
const createDisciplineCasesRouter = require("./routes/discipline_cases");
const createEventsRouter = require("./routes/events");
const applicationsRouter = require("./routes/applications");

// Import marks module routes
const accademicYearRouter = require("./src/routes/accademicYear.route");
const subjectRouter = require("./src/routes/subject.route");
const classSubjectRouter = require("./src/routes/classSubject.route");
const departmentClassesRouter = require("./src/routes/departmentClasses.route");
const teacherRouter = require("./src/routes/teachers.route");
const classRouter = require("./src/routes/class.route");
const academicBandRouter = require("./src/routes/academicBand.route");
const marksRouter = require("./src/routes/mark.route");
const studentRouter = require("./src/routes/students.route");
const reportCardRouter = require("./src/routes/reportCard.route");
const globalErrorController = require("./src/controllers/error.controller");

// Import FTP service
const ftpService = require("./ftp-service");

const app = express();
const JWT_SECRET = process.env.JWT_SECRET || "your-secret-key";
const PORT = 5000;

if (
  !process.env.DB_NAME ||
  !process.env.DB_PASSWORD ||
  !process.env.DB_USER_NAME
) {
  throw new Error("Database environment variables not set.");
}

// DB connection
const sequelize = new Sequelize(
  process.env.DB_NAME,
  process.env.DB_USER_NAME,
  process.env.DB_PASSWORD,
  {
    host: "31.97.113.198",
    dialect: "postgres",
  }
);

// Test connection
sequelize
  .authenticate()
  .then(async () => {
    await sequelize.sync({ force: false, alter: true });
    (async () => {
      try {
        await sequelize.sync({ alter: true });
        console.log("All tables synced!");
      } catch (error) {
        console.error("Sync failed:", error);
      }
    })();
    console.log("✅ DB connected");
  })
  .catch((err) => console.error("❌ DB connection error:", err));

// Log every incoming request
app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.originalUrl}`);
  next();
});

// Configure multer for file uploads
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, "uploads/");
  },
  filename: function (req, file, cb) {
    const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
    cb(
      null,
      file.fieldname + "-" + uniqueSuffix + path.extname(file.originalname)
    );
  },
});

// Use memory storage for student uploads
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB limit for all files
    files: 3, // Maximum 3 files (certificate, cv, photo)
  },
  fileFilter: function (req, file, cb) {
    // Allow images, PDFs, and common document formats
    const allowedTypes = [
      "image/jpeg",
      "image/jpg",
      "image/png",
      "image/gif",
      "application/pdf",
      "application/msword",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ];
    if (allowedTypes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(
        new Error(
          `File type ${file.mimetype} not allowed. Only images, PDFs, and Word documents are accepted.`
        ),
        false
      );
    }
  },
});

// Configure multer for Excel file uploads
const excelUpload = multer({
  storage: multer.memoryStorage(), // Use memory storage instead of disk storage
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB limit for Excel files
  },
  fileFilter: function (req, file, cb) {
    // Accept Excel files
    if (
      file.mimetype ===
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" ||
      file.mimetype === "application/vnd.ms-excel"
    ) {
      cb(null, true);
    } else {
      cb(new Error("Only Excel files (.xlsx, .xls) are allowed!"), false);
    }
  },
});

// Create uploads directory if it doesn't exist
const fs = require("fs");
if (!fs.existsSync("uploads")) {
  fs.mkdirSync("uploads");
}

// Function to find an available port
const findAvailablePort = (startPort) => {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on("error", (err) => {
      if (err.code === "EADDRINUSE") {
        findAvailablePort(startPort + 1)
          .then(resolve)
          .catch(reject);
      } else {
        reject(err);
      }
    });
    server.listen(startPort, () => {
      const { port } = server.address();
      server.close(() => {
        resolve(port);
      });
    });
  });
};

// CORS configuration with dynamic origin
const corsOptions = {
  origin: function (origin, callback) {
    console.log("CORS request from origin:", origin);
    const allowedOrigins = [
      "https://votechs7academygroup.com", // Production frontend
      "https://votech-latest-front.onrender.com", // Keep for backup
      "http://localhost:3000", // local development
      "http://localhost:3001", // local development (frontend port)
      "http://localhost:3004", // local development (alternate port)
    ];
    // Allow requests with no origin (like mobile apps or curl requests)
    if (!origin) {
      console.log("No origin provided, allowing request");
      return callback(null, true);
    }
    if (allowedOrigins.indexOf(origin) !== -1) {
      console.log("Origin allowed:", origin);
      callback(null, true);
    } else {
      console.log("Origin not allowed:", origin);
      callback(new Error("Not allowed by CORS"));
    }
  },
  methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
  allowedHeaders: [
    "Content-Type",
    "Authorization",
    "Accept",
    "Origin",
    "X-Requested-With",
  ],
  exposedHeaders: ["Content-Range", "X-Content-Range"],
  credentials: true,
  maxAge: 86400,
};

// Middleware
app.use(cors(corsOptions));
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));
app.use("/uploads", express.static("uploads")); // Serve uploaded files
app.options("*", cors(corsOptions));

// Authentication middleware
function authenticateToken(req, res, next) {
  console.log("Authenticating request...");
  const authHeader = req.headers["authorization"];
  if (!authHeader) {
    console.log("No authorization header");
    return res.status(401).json({ error: "No authorization header" });
  }
  const token = authHeader.split(" ")[1];
  if (!token) {
    console.log("No token in authorization header");
    return res.status(401).json({ error: "No token provided" });
  }
  try {
    const user = jwt.verify(token, JWT_SECRET);
    console.log("Token verified for user:", user.username);
    req.user = user;
    next();
  } catch (err) {
    console.error("Token verification failed:", err.message);
    if (err.name === "TokenExpiredError") {
      return res.status(401).json({ error: "Token expired" });
    }
    return res.status(403).json({ error: "Invalid token" });
  }
}

// Helper function to create user session
const createUserSession = async (
  userId,
  ipAddress = null,
  userAgent = null
) => {
  try {
    const result = await pool.query(
      `
      INSERT INTO user_sessions (user_id, ip_address, user_agent)
      VALUES ($1, $2, $3)
      RETURNING id
    `,
      [userId, ipAddress, userAgent]
    );
    return result.rows[0].id;
  } catch (error) {
    console.error("Error creating user session:", error);
    return null;
  }
};

// Helper function to log user activity
const logUserActivity = async (
  userId,
  activityType,
  activityDescription,
  entityType = null,
  entityId = null,
  entityName = null,
  ipAddress = null,
  userAgent = null
) => {
  try {
    await pool.query(
      `
      INSERT INTO user_activities (user_id, activity_type, activity_description, entity_type, entity_id, entity_name, ip_address, user_agent)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
    `,
      [
        userId,
        activityType,
        activityDescription,
        entityType,
        entityId,
        entityName,
        ipAddress,
        userAgent,
      ]
    );
  } catch (error) {
    console.error("Error logging user activity:", error);
  }
};

// Helper function to end user session
const endUserSession = async (userId) => {
  try {
    await pool.query(
      `
      UPDATE user_sessions 
      SET session_end = CURRENT_TIMESTAMP, status = 'ended'
      WHERE user_id = $1 AND session_end IS NULL
    `,
      [userId]
    );
  } catch (error) {
    console.error("Error ending user session:", error);
  }
};

// Route registration
// Authentication routes
app.use('/api', authRoutes);

// Fee management routes
app.use('/api/fees', feesRoutes);

// Student management routes
app.use('/api/students', studentsRoutes);

// Class management routes
app.use('/api/classes', classesRoutes);

// Teacher management routes
app.use('/api/teachers', teachersRoutes);

// User management routes
app.use('/api/users', usersRoutes);

// Messaging routes
app.use('/api/messages', messagesRoutes);

// Inventory management routes
app.use('/api/inventory', inventoryRoutes);

// Subjects routes
app.use('/api/subjects', subjectsRouter);

// Lesson plans routes
app.use('/api/lesson-plans', lessonPlansRouter);

// Lessons routes
app.use('/api/lessons', lessonsRouter);

// Groups routes
app.use('/api/groups', groupsRouter);

// Salary routes
app.use('/api/salary', salaryRouter);

// Timetables routes
app.use('/api/timetables', timetablesRouter);

// Cases routes
app.use('/api/cases', casesRouter);

// Attendance routes
app.use('/api/attendance', createAttendanceRouter(pool, authenticateToken));

// Discipline cases routes
app.use('/api/discipline-cases', createDisciplineCasesRouter(pool, authenticateToken));

// Events routes
app.use('/api/events', createEventsRouter(pool, authenticateToken));

// Applications routes
app.use('/api/applications', applicationsRouter);

// Marks module routes
app.use("/api/v1/academic-years", accademicYearRouter);
app.use("/api/v1/subjects", subjectRouter);
app.use("/api/v1/class-subjects", classSubjectRouter);
app.use("/api/v1/department-classes", departmentClassesRouter);
app.use("/api/v1/teachers", teacherRouter);
app.use("/api/v1/classes", classRouter);
app.use("/api/v1/academic-bands", academicBandRouter);
app.use("/api/v1/marks", marksRouter);
app.use("/api/v1/students", studentRouter);
app.use("/api/v1/report-cards", reportCardRouter);

// Public endpoints (no authentication required)
app.get("/api/test", (req, res) => {
  res.json({ message: "Server is running" });
});

app.get("/api/lesson-plans/test", (req, res) => {
  res.json({ message: "Lesson plans endpoint is working" });
});

// Temporary endpoint to create admin user (remove in production)
app.post("/api/setup-admin", async (req, res) => {
  try {
    const adminPassword = "admin1234";
    const hashedPassword = await bcrypt.hash(adminPassword, 10);
    // Check if admin user exists
    const result = await pool.query("SELECT * FROM users WHERE username = $1", [
      "admin1234",
    ]);
    const existingUsers = result.rows;
    if (existingUsers.length > 0) {
      // Update existing admin password and role
      await pool.query(
        "UPDATE users SET password = $1, role = $2 WHERE username = $3",
        [hashedPassword, "admin", "admin1234"]
      );
      console.log("Admin password and role updated");
    } else {
      // Create new admin user with role admin
      await pool.query(
        "INSERT INTO users (username, password, email, contact, is_default, role) VALUES ($1, $2, $3, $4, $5, $6)",
        [
          "admin1234",
          hashedPassword,
          "admin@example.com",
          "+237000000000",
          true,
          "admin",
        ]
      );
      console.log("Admin user created");
    }
    res.json({
      message: "Admin user setup complete",
      username: "admin1234",
      password: "admin1234",
    });
  } catch (error) {
    console.error("Error setting up admin:", error);
    res.status(500).json({ error: "Failed to setup admin user" });
  }
});

// Login endpoint
app.post("/api/login", async (req, res) => {
  const { username, password } = req.body;
  console.log("Login attempt for:", username);
  try {
    const result = await pool.query("SELECT * FROM users WHERE username = $1", [
      username,
    ]);
    const users = result.rows;
    if (users.length === 0) {
      console.log("User not found:", username);
      return res.status(401).json({ error: "Invalid credentials" });
    }
    const user = users[0];
    if (user.suspended) {
      return res.status(403).json({
        error: "This account is suspended. Please contact the administrator.",
      });
    }
    const validPassword = await bcrypt.compare(password, user.password);
    if (!validPassword) {
      console.log("Invalid password for:", username);
      return res.status(401).json({ error: "Invalid credentials" });
    }

    // Get IP address and user agent
    const ipAddress =
      req.ip ||
      req.connection.remoteAddress ||
      req.headers["x-forwarded-for"] ||
      "unknown";
    const userAgent = req.headers["user-agent"] || "unknown";

    // Create user session
    await createUserSession(user.id, ipAddress, userAgent);

    // Log login activity
    await logUserActivity(
      user.id,
      "login",
      `User logged in successfully`,
      null,
      null,
      null,
      ipAddress,
      userAgent
    );

    // Create token with expiration and role
    const token = jwt.sign(
      { id: user.id, username: user.username, role: user.role },
      JWT_SECRET,
      { expiresIn: "24h" }
    );
    // Send back user data (excluding password) along with token
    const userData = {
      id: user.id,
      username: user.username,
      contact: user.contact,
      created_at: user.created_at,
      role: user.role,
      profile_image_url: user.profile_image_url || null,
      // Keep camelCase for frontend convenience
      profileImageUrl: user.profile_image_url || null,
    };
    // Check for academic years if admin
    let requireAcademicYear = false;
    if (["Admin1", "Admin2", "Admin3", "Admin4"].includes(user.role)) {
      const yearsResult = await pool.query(
        "SELECT COUNT(*) FROM academic_years"
      );
      const count = parseInt(yearsResult.rows[0].count, 10);
      requireAcademicYear = count === 0; // or set to true to always require
    }
    console.log("Login successful for:", username);
    res.json({
      token,
      user: userData,
      requireAcademicYear,
    });
  } catch (error) {
    console.error("Login error:", error);
    res.status(500).json({ error: "Server error" });
  }
});

// Logout endpoint
app.post("/api/logout", authenticateToken, async (req, res) => {
  try {
    const ipAddress =
      req.ip ||
      req.connection.remoteAddress ||
      req.headers["x-forwarded-for"] ||
      "unknown";
    const userAgent = req.headers["user-agent"] || "unknown";

    // End user session
    await endUserSession(req.user.id);

    // Log logout activity
    await logUserActivity(
      req.user.id,
      "logout",
      `User logged out successfully`,
      null,
      null,
      null,
      ipAddress,
      userAgent
    );

    res.json({ message: "Logged out successfully" });
  } catch (error) {
    console.error("Logout error:", error);
    res.status(500).json({ error: "Server error" });
  }
});

// Error handling middleware
app.use((err, req, res, next) => {
  console.error("Error:", err);
  res
    .status(500)
    .json({ error: "Internal server error", details: err.message });
});

// Global error controller
app.use(globalErrorController);

// 404 handler
app.all("*", (req, res, next) => {
  const error = new Error(
    `No route exists for '${req.originalUrl}' with ${req.method} request`
  );
  error.statusCode = 404;
  next(error);
});

// Start server
const startServer = async () => {
  try {
    console.log("Starting server...");
    // Kill any process using port 5000
    if (process.platform === "win32") {
      try {
        await execAsync("netstat -ano | findstr :5000");
        await execAsync(
          "for /f \"tokens=5\" %a in ('netstat -aon ^| findstr :5000') do taskkill /F /PID %a"
        );
        console.log("Killed existing process on port 5000");
      } catch (error) {
        // No process was found on port 5000, which is fine
      }
    } else {
      try {
        await execAsync(
          "lsof -i :5000 | grep LISTEN | awk '{print $2}' | xargs kill -9"
        );
        console.log("Killed existing process on port 5000");
      } catch (error) {
        // No process was found on port 5000, which is fine
      }
    }
    console.log("Connecting to database...");
    await pool.connect();
    console.log("Connected to database");
    
    // Find available port
    const availablePort = await findAvailablePort(PORT);
    console.log("Available port found:", availablePort);
    app.listen(availablePort, () => {
      console.log(`Server running on port ${availablePort}`);
      console.log(
        `Frontend should be accessible at: http://localhost:${availablePort}`
      );
    });
  } catch (error) {
    console.error("Failed to start server:", error);
    process.exit(1);
  }
};

startServer();

// Export pool for use in other modules
module.exports = { pool };
