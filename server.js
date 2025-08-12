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
// Import routes
const lessonPlansRouter = require("./routes/lessonPlans");
const groupsRouter = require("./routes/groups");
const salaryRouter = require("./routes/salary");
const timetablesRouter = require("./routes/timetables");
// Import FTP service at the top of the file
const ftpService = require("./ftp-service");
const app = express();
const JWT_SECRET = process.env.JWT_SECRET || "your-secret-key";
const PORT = 5000;

//local imports
const marksModuleApp = require("./src/app");

if (
  !process.env.DB_NAME ||
  !process.env.DB_PASSWORD ||
  !process.env.DB_USER_NAME
) {
  throw new Error("Database enviroment variables not set.");
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
// Create uploads directory if it doesn't exist (for non-Excel files)
const fs = require("fs");
const accademicYearRouter = require("./src/routes/accademicYear.route");
const subjectRouter = require("./src/routes/subject.route");
const classSubjectRouter = require("./src/routes/classSubject.route");
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
// Use routes
app.use("/api/lesson-plans", lessonPlansRouter);
app.use("/api/groups", groupsRouter);
app.use("/api/salary", salaryRouter);
app.use("/api/timetables", timetablesRouter);
//marks module
app.use("/api/v1/academic-years", accademicYearRouter);
app.use("/api/v1/subjects", subjectRouter);
app.use("/api/v1/class-subjects", classSubjectRouter);
// Error handling middleware
app.use((err, req, res, next) => {
  console.error("Error:", err);
  res
    .status(500)
    .json({ error: "Internal server error", details: err.message });
});
// Authentication middleware
const authenticateToken = (req, res, next) => {
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
};
// Public endpoints (no authentication required)
app.get("/api/test", (req, res) => {
  res.json({ message: "Server is running" });
});
// Test lesson plans endpoint
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
app.post("/api/register", async (req, res) => {
  console.log("Received registration request:", {
    body: req.body,
    headers: req.headers,
    method: req.method,
    url: req.url,
  });
  const { username, contact, password, role, name, email, gender } = req.body;
  if (!username || !password) {
    console.log("Missing required fields:", {
      username: !!username,
      password: !!password,
    });
    return res
      .status(400)
      .json({ error: "Username and password are required" });
  }
  // Expanded allowed roles
  const allowedRoles = [
    "student",
    "Teacher",
    "parent",
    "Admin1",
    "Admin2",
    "Admin3",
    "Admin4",
    "Secretary",
    "Discipline",
    "Psychosocialist",
  ];
  let userRole = role && allowedRoles.includes(role) ? role : "student";
  try {
    // Check if username exists
    const result = await pool.query("SELECT * FROM users WHERE username = $1", [
      username,
    ]);
    const users = result.rows;
    if (users.length > 0) {
      console.log("Username already exists:", username);
      return res.status(400).json({ error: "Username already exists" });
    }
    // Hash the password
    const hashedPassword = await bcrypt.hash(password, 10);
    // Create new user with all fields
    const insertResult = await pool.query(
      "INSERT INTO users (username, contact, password, role, name, email, gender) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *",
      [username, contact, hashedPassword, userRole, name, email, gender]
    );
    const newUser = insertResult.rows[0];
    console.log("Account created successfully:", {
      username,
      userId: newUser.id,
      role: userRole,
    });
    res.status(201).json({ message: "Account created successfully" });
  } catch (error) {
    console.error("Error in registration endpoint:", error);
    res
      .status(500)
      .json({ error: `Failed to create account: ${error.message}` });
  }
});
app.post("/api/check-user", async (req, res) => {
  const { username } = req.body;
  console.log("Checking if user exists:", username);
  try {
    const [users] = await pool.query(
      "SELECT username FROM users WHERE username = $1",
      [username]
    );
    if (users.length > 0) {
      console.log("User exists:", username);
      res.json({ exists: true });
    } else {
      console.log("User does not exist:", username);
      res.json({ exists: false });
    }
  } catch (error) {
    console.error("Error checking user:", error);
    res.status(500).json({ error: "Server error" });
  }
});
app.post("/api/reset-password", async (req, res) => {
  const { username, newPassword } = req.body;
  console.log("Password reset request for:", username);
  try {
    // Check if user exists
    const result = await pool.query("SELECT * FROM users WHERE username = $1", [
      username,
    ]);
    const users = result.rows;
    if (users.length === 0) {
      console.log("User not found for password reset:", username);
      return res.status(404).json({ error: "User not found" });
    }
    // Hash the new password
    const hashedPassword = await bcrypt.hash(newPassword, 10);
    // Update the password
    await pool.query("UPDATE users SET password = $1 WHERE username = $2", [
      hashedPassword,
      username,
    ]);
    console.log("Password reset successful for:", username);
    res.json({ message: "Password reset successfully" });
  } catch (error) {
    console.error("Error resetting password:", error);
    res.status(500).json({ error: "Server error" });
  }
});
app.post("/api/change-password", authenticateToken, async (req, res) => {
  const { currentPassword, newPassword } = req.body;
  const userId = req.user.id;
  try {
    // Get current user
    const [users] = await pool.query("SELECT * FROM users WHERE id = $1", [
      userId,
    ]);
    if (users.length === 0) {
      return res.status(404).json({ error: "User not found" });
    }
    const user = users[0];
    // Verify current password
    const validPassword = await bcrypt.compare(currentPassword, user.password);
    if (!validPassword) {
      return res.status(400).json({ error: "Current password is incorrect" });
    }
    // Hash new password
    const hashedPassword = await bcrypt.hash(newPassword, 10);
    // Update password
    await pool.query("UPDATE users SET password = $1 WHERE id = $2", [
      hashedPassword,
      userId,
    ]);
    res.json({ message: "Password changed successfully" });
  } catch (error) {
    console.error("Error changing password:", error);
    res.status(500).json({ error: "Server error" });
  }
});
// Users endpoints
app.get("/api/users", authenticateToken, async (req, res) => {
  try {
    const [users] = await pool.query(
      "SELECT id, username, email, contact, created_at FROM users WHERE id = $1",
      [req.user.id]
    );
    console.log("Successfully fetched users:", users);
    res.json(users);
  } catch (error) {
    console.error("Error fetching users:", error);
    res.status(500).json({ error: "Error fetching users" });
  }
});
// Excel upload endpoint for bulk student registration
app.post(
  "/api/students/upload",
  authenticateToken,
  excelUpload.single("file"),
  async (req, res) => {
    const userId = req.user.id;
    if (!req.file) {
      return res.status(400).json({ error: "No Excel file uploaded" });
    }
    function parseExcelDate(dateStr) {
      if (!dateStr) return "";
      // If it's a number, treat as Excel serial date
      if (typeof dateStr === "number") {
        // Excel's epoch starts at 1900-01-01
        const excelEpoch = new Date(Date.UTC(1899, 11, 30));
        const d = new Date(excelEpoch.getTime() + dateStr * 86400000);
        // Format as yyyy-mm-dd
        return d.toISOString().slice(0, 10);
      }
      // Accept both Date objects and strings
      if (dateStr instanceof Date) {
        return dateStr.toISOString().slice(0, 10);
      }
      if (typeof dateStr === "string") {
        // Try to parse d-MMM-yyyy (e.g., 5-Dec-2025)
        const match = /^([0-9]{1,2})[-.\/]([A-Za-z]{3})[-.\/]([0-9]{4})$/.exec(
          dateStr.trim()
        );
        if (match) {
          const day = match[1].padStart(2, "0");
          const monthStr = match[2].toLowerCase();
          const year = match[3];
          const months = {
            jan: "01",
            feb: "02",
            mar: "03",
            apr: "04",
            may: "05",
            jun: "06",
            jul: "07",
            aug: "08",
            sep: "09",
            oct: "10",
            nov: "11",
            dec: "12",
          };
          const month = months[monthStr] || "01";
          return `${year}-${month}-${day}`;
        }
        // Try to parse yyyy-mm-dd
        if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return dateStr;
        // Fallback: return as is
        return dateStr;
      }
      // Fallback: return as is
      return dateStr;
    }
    function normalizeSex(sex) {
      if (!sex) return "Male";
      const s = sex.toString().trim().toLowerCase();
      if (s === "f" || s === "female") return "Female";
      return "Male";
    }
    try {
      // Read the Excel file from memory
      const workbook = XLSX.read(req.file.buffer, { type: "buffer" });
      const sheetName = workbook.SheetNames[0];
      const worksheet = workbook.Sheets[sheetName];
      // Convert to JSON
      const data = XLSX.utils.sheet_to_json(worksheet, { header: 1 });
      // Skip the header row and process data
      const students = [];
      for (let i = 1; i < data.length; i++) {
        const row = data[i];
        // Skip row if all fields are empty
        if (
          !row ||
          row.length < 11 ||
          row.every(
            (cell) => cell === undefined || cell === null || cell === ""
          )
        )
          continue;
        if (row[0]) {
          // Only process if Full Name is present
          students.push({
            full_name: row[0] || "",
            sex: normalizeSex(row[1]),
            date_of_birth: parseExcelDate(row[2]),
            place_of_birth: row[3] || "",
            father_name: row[4] || "",
            mother_name: row[5] || "",
            guardian_contact: row[6] || "",
            vocational_training: row[7] || "",
            class_id: row[8] || "",
            year: row[9] || "",
          });
        }
      }
      if (students.length === 0) {
        return res
          .status(400)
          .json({ error: "No valid student data found in the Excel file" });
      }
      // Insert students into database
      const insertPromises = students.map((student) => {
        return pool
          .query(
            `INSERT INTO students (user_id, full_name, sex, date_of_birth, place_of_birth, father_name, mother_name, guardian_contact, vocational_training, student_picture, class_id, year)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13) RETURNING *`,
            [
              userId,
              student.full_name,
              student.sex,
              student.date_of_birth,
              student.place_of_birth,
              student.father_name,
              student.mother_name,
              student.guardian_contact,
              student.vocational_training,
              student.student_picture,
              student.class_id,
              student.year,
            ]
          )
          .catch((err) => {
            console.error("Failed to insert row:", student, err.message);
            throw err;
          });
      });
      const results = await Promise.all(insertPromises);
      // Clean up the uploaded file
      const fs = require("fs");
      fs.unlinkSync(req.file.path);
      res.json({
        message: `${results.length} students uploaded successfully`,
        count: results.length,
      });
    } catch (error) {
      console.error("Error uploading students:", error);
      // Clean up the uploaded file in case of error
      if (req.file) {
        const fs = require("fs");
        try {
          fs.unlinkSync(req.file.path);
        } catch (unlinkError) {
          console.error("Error deleting uploaded file:", unlinkError);
        }
      }
      res.status(500).json({
        error: "Error uploading students from Excel file",
        details: error.message,
      });
    }
  }
);
// Student analytics endpoint: students added per day for all time
app.get("/api/students/analytics/daily", async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT DATE(created_at) as date, COUNT(*) as count
       FROM students
       GROUP BY DATE(created_at)
       ORDER BY date ASC`
    );
    res.json(result.rows);
  } catch (error) {
    console.error("Error fetching student analytics:", error);
    res.status(500).json({
      error: "Error fetching student analytics",
      details: error.message,
    });
  }
});
// Student analytics endpoint: students added per month (all time)
app.get("/api/students/analytics/monthly", async (req, res) => {
  try {
    const result = await pool.query(
      `SELECT TO_CHAR(created_at, 'YYYY-MM') as month, COUNT(*) as count
       FROM students
       GROUP BY month
       ORDER BY month ASC`
    );
    res.json(result.rows);
  } catch (error) {
    console.error("Error fetching student monthly analytics:", error);
    res.status(500).json({
      error: "Error fetching student monthly analytics",
      details: error.message,
    });
  }
});
// CLASSES ENDPOINTS
app.get("/api/classes", authenticateToken, async (req, res) => {
  try {
    const result = await pool.query("SELECT * FROM classes ORDER BY id DESC");
    res.json(result.rows);
  } catch (error) {
    console.error("Error fetching classes:", error);
    res
      .status(500)
      .json({ error: "Error fetching classes", details: error.message });
  }
});
// Remove authentication for class creation
app.post("/api/classes", async (req, res) => {
  console.log("POST /api/classes called", req.body);
  const {
    name,
    registration_fee,
    bus_fee,
    internship_fee,
    remedial_fee,
    tuition_fee,
    pta_fee,
    total_fee,
    suspended,
  } = req.body;
  try {
    const result = await pool.query(
      `INSERT INTO classes (name, registration_fee, bus_fee, internship_fee, remedial_fee, tuition_fee, pta_fee, total_fee, suspended)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
      [
        name,
        registration_fee,
        bus_fee,
        internship_fee,
        remedial_fee,
        tuition_fee,
        pta_fee,
        total_fee,
        suspended || false,
      ]
    );
    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error("Error creating class:", error);
    res
      .status(500)
      .json({ error: "Error creating class", details: error.message });
  }
});
app.put("/api/classes/:id", authenticateToken, async (req, res) => {
  const { id } = req.params;
  const {
    name,
    registration_fee,
    bus_fee,
    internship_fee,
    remedial_fee,
    tuition_fee,
    pta_fee,
    total_fee,
    suspended,
  } = req.body;
  try {
    const result = await pool.query(
      `UPDATE classes SET name=$1, registration_fee=$2, bus_fee=$3, internship_fee=$4, remedial_fee=$5, tuition_fee=$6, pta_fee=$7, total_fee=$8, suspended=$9 WHERE id=$10 RETURNING *`,
      [
        name,
        registration_fee,
        bus_fee,
        internship_fee,
        remedial_fee,
        tuition_fee,
        pta_fee,
        total_fee,
        suspended || false,
        id,
      ]
    );
    if (result.rows.length === 0)
      return res.status(404).json({ error: "Class not found" });
    res.json(result.rows[0]);
  } catch (error) {
    console.error("Error updating class:", error);
    res
      .status(500)
      .json({ error: "Error updating class", details: error.message });
  }
});
app.delete("/api/classes/:id", authenticateToken, async (req, res) => {
  const { id } = req.params;
  try {
    await pool.query("DELETE FROM classes WHERE id=$1", [id]);
    res.json({ success: true });
  } catch (error) {
    console.error("Error deleting class:", error);
    res
      .status(500)
      .json({ error: "Error deleting class", details: error.message });
  }
});
// Vocational endpoints
app.post(
  "/api/vocational",
  authenticateToken,
  upload.fields([
    { name: "picture1", maxCount: 1 },
    { name: "picture2", maxCount: 1 },
    { name: "picture3", maxCount: 1 },
    { name: "picture4", maxCount: 1 },
  ]),
  async (req, res) => {
    const { title, description, year } = req.body;
    const userId = req.user.id;
    // Get file paths from uploaded files
    const picture1 = req.files.picture1
      ? `/uploads/${req.files.picture1[0].filename}`
      : null;
    const picture2 = req.files.picture2
      ? `/uploads/${req.files.picture2[0].filename}`
      : null;
    const picture3 = req.files.picture3
      ? `/uploads/${req.files.picture3[0].filename}`
      : null;
    const picture4 = req.files.picture4
      ? `/uploads/${req.files.picture4[0].filename}`
      : null;
    try {
      const result = await pool.query(
        `INSERT INTO vocational (user_id, name, description, picture1, picture2, picture3, picture4, year)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
        [
          userId,
          title,
          description,
          picture1,
          picture2,
          picture3,
          picture4,
          year,
        ]
      );
      res.status(201).json({ id: result.rows[0].id });
    } catch (error) {
      console.error("Error creating vocational department:", error);
      res.status(500).json({ error: "Error creating vocational department" });
    }
  }
);
app.get("/api/vocational", authenticateToken, async (req, res) => {
  const year = req.query.year ? parseInt(req.query.year) : null;
  try {
    let query =
      "SELECT id, user_id, name as title, description, picture1, picture2, picture3, picture4, year, created_at, updated_at FROM vocational";
    let params = [];
    if (year) {
      query += " WHERE year = $1";
      params.push(year);
    }
    query += " ORDER BY created_at DESC";
    const resultVoc = await pool.query(query, params);
    res.json(resultVoc.rows);
  } catch (error) {
    console.error("Error fetching vocational departments:", error);
    res.status(500).json({ error: "Error fetching vocational departments" });
  }
});
app.put(
  "/api/vocational/:id",
  authenticateToken,
  upload.fields([
    { name: "picture1", maxCount: 1 },
    { name: "picture2", maxCount: 1 },
    { name: "picture3", maxCount: 1 },
    { name: "picture4", maxCount: 1 },
  ]),
  async (req, res) => {
    const { title, description, year } = req.body;
    const userId = req.user.id;
    const vocationalId = req.params.id;
    // Get file paths from uploaded files
    const picture1 = req.files.picture1
      ? `/uploads/${req.files.picture1[0].filename}`
      : undefined;
    const picture2 = req.files.picture2
      ? `/uploads/${req.files.picture2[0].filename}`
      : undefined;
    const picture3 = req.files.picture3
      ? `/uploads/${req.files.picture3[0].filename}`
      : undefined;
    const picture4 = req.files.picture4
      ? `/uploads/${req.files.picture4[0].filename}`
      : undefined;
    try {
      // First verify the vocational department belongs to the user
      const resultVocPut = await pool.query(
        "SELECT * FROM vocational WHERE id = $1 AND user_id = $2",
        [vocationalId, userId]
      );
      if (resultVocPut.rows.length === 0) {
        return res
          .status(404)
          .json({ error: "Vocational department not found" });
      }
      // Build update query and values dynamically
      let updateFields = ["name = $1", "description = $2", "year = $3"];
      let updateValues = [title, description, year];
      let paramIndex = 4;
      if (picture1 !== undefined) {
        updateFields.push(`picture1 = $${paramIndex}`);
        updateValues.push(picture1);
        paramIndex++;
      }
      if (picture2 !== undefined) {
        updateFields.push(`picture2 = $${paramIndex}`);
        updateValues.push(picture2);
        paramIndex++;
      }
      if (picture3 !== undefined) {
        updateFields.push(`picture3 = $${paramIndex}`);
        updateValues.push(picture3);
        paramIndex++;
      }
      if (picture4 !== undefined) {
        updateFields.push(`picture4 = $${paramIndex}`);
        updateValues.push(picture4);
        paramIndex++;
      }
      // Add WHERE clause
      updateFields = updateFields.join(", ");
      updateValues.push(vocationalId, userId);
      const updateQuery = `UPDATE vocational SET ${updateFields} WHERE id = $${paramIndex} AND user_id = $${
        paramIndex + 1
      }`;
      // Update the vocational department
      await pool.query(updateQuery, updateValues);
      res.json({ message: "Vocational department updated successfully" });
    } catch (error) {
      console.error("Error updating vocational department:", error);
      res.status(500).json({ error: "Error updating vocational department" });
    }
  }
);
app.delete("/api/vocational/:id", authenticateToken, async (req, res) => {
  const userId = req.user.id;
  const vocationalId = req.params.id;
  try {
    // First verify the vocational department belongs to the user
    const resultVocDel = await pool.query(
      "SELECT * FROM vocational WHERE id = $1 AND user_id = $2",
      [vocationalId, userId]
    );
    if (resultVocDel.rows.length === 0) {
      return res.status(404).json({ error: "Vocational department not found" });
    }
    // Delete the vocational department
    await pool.query("DELETE FROM vocational WHERE id = $1 AND user_id = $2", [
      vocationalId,
      userId,
    ]);
    res.json({ message: "Vocational department deleted successfully" });
  } catch (error) {
    console.error("Error deleting vocational department:", error);
    res.status(500).json({ error: "Error deleting vocational department" });
  }
});
// Teachers endpoints (Admin: full CRUD, others: only their own if needed)
app.post("/api/teachers", authenticateToken, async (req, res) => {
  const { full_name, sex, id_card, dob, pob, subjects, classes, contact } =
    req.body;
  // Allow only admins to add teachers (or remove this check if all can add)
  if (
    !["admin", "Admin1", "Admin2", "Admin3", "Admin4"].includes(req.user.role)
  ) {
    return res.status(403).json({ error: "Forbidden" });
  }
  try {
    const result = await pool.query(
      `INSERT INTO teachers (full_name, sex, id_card, dob, pob, subjects, classes, contact)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
      [full_name, sex, id_card, dob, pob, subjects, classes, contact]
    );
    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error("Error creating teacher:", error);
    res.status(500).json({ error: "Error creating teacher" });
  }
});
// Get all teachers (admin) or only own (if needed)
app.get("/api/teachers", authenticateToken, async (req, res) => {
  try {
    let result;
    if (
      ["admin", "Admin1", "Admin2", "Admin3", "Admin4"].includes(req.user.role)
    ) {
      result = await pool.query(
        "SELECT * FROM teachers ORDER BY created_at DESC"
      );
    } else {
      // If you want to restrict for non-admins, add logic here
      result = await pool.query(
        "SELECT * FROM teachers ORDER BY created_at DESC"
      );
    }
    res.json(result.rows);
  } catch (error) {
    console.error("Error fetching teachers:", error);
    res.status(500).json({ error: "Error fetching teachers" });
  }
});
app.put("/api/teachers/:id", authenticateToken, async (req, res) => {
  const { id } = req.params;
  const { full_name, sex, id_card, dob, pob, subjects, classes, contact } =
    req.body;
  if (
    !["admin", "Admin1", "Admin2", "Admin3", "Admin4"].includes(req.user.role)
  ) {
    return res.status(403).json({ error: "Forbidden" });
  }
  try {
    const result = await pool.query(
      `UPDATE teachers SET full_name=$1, sex=$2, id_card=$3, dob=$4, pob=$5, subjects=$6, classes=$7, contact=$8 WHERE id=$9 RETURNING *`,
      [full_name, sex, id_card, dob, pob, subjects, classes, contact, id]
    );
    if (result.rows.length === 0)
      return res.status(404).json({ error: "Teacher not found" });
    res.json(result.rows[0]);
  } catch (error) {
    console.error("Error updating teacher:", error);
    res.status(500).json({ error: "Error updating teacher" });
  }
});
app.delete("/api/teachers/:id", authenticateToken, async (req, res) => {
  const { id } = req.params;
  if (
    !["admin", "Admin1", "Admin2", "Admin3", "Admin4"].includes(req.user.role)
  ) {
    return res.status(403).json({ error: "Forbidden" });
  }
  try {
    const result = await pool.query(
      "DELETE FROM teachers WHERE id=$1 RETURNING *",
      [id]
    );
    if (result.rows.length === 0)
      return res.status(404).json({ error: "Teacher not found" });
    res.json({ message: "Teacher deleted successfully" });
  } catch (error) {
    console.error("Error deleting teacher:", error);
    res.status(500).json({ error: "Error deleting teacher" });
  }
});
// New endpoint for admin to approve/reject teachers
app.put("/api/teachers/:id/status", authenticateToken, async (req, res) => {
  console.log("User object for approval:", req.user);
  if (req.user.role !== "Admin3") {
    return res
      .status(403)
      .json({ error: "Only Admin3 can approve/reject teachers" });
  }
  const { status } = req.body;
  const userId = req.user.id;
  const teacherId = req.params.id;
  try {
    // Validate status
    if (!["approved", "pending", "rejected"].includes(status)) {
      return res.status(400).json({
        error: 'Invalid status. Must be "approved", "pending", or "rejected"',
      });
    }
    // Update the teacher status
    const result = await pool.query(
      `UPDATE teachers
       SET status = $1
       WHERE id = $2 RETURNING *`,
      [status, teacherId]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Teacher not found" });
    }
    res.json({ message: `Teacher ${status} successfully` });
  } catch (error) {
    console.error("Error updating teacher status:", error);
    res.status(500).json({ error: "Error updating teacher status" });
  }
});
// Teacher analytics endpoint: teachers added per day for the last 30 days
app.get(
  "/api/teachers/analytics/daily",
  authenticateToken,
  async (req, res) => {
    const userId = req.user.id;
    const userRole = req.user.role;
    const year = req.query.year ? parseInt(req.query.year) : null;
    try {
      let rows;
      if (userRole === "admin") {
        // Admin can view analytics for all teachers
        if (year) {
          [rows] = await pool.query(
            `SELECT DATE(created_at) as date, COUNT(*) as count
           FROM teachers
           WHERE EXTRACT(YEAR FROM created_at) = $1 AND created_at >= (CURRENT_DATE - INTERVAL '30 days')
           GROUP BY DATE(created_at)
           ORDER BY date ASC`,
            [year]
          );
        } else {
          [rows] = await pool.query(
            `SELECT DATE(created_at) as date, COUNT(*) as count
           FROM teachers
           WHERE created_at >= (CURRENT_DATE - INTERVAL '30 days')
           GROUP BY DATE(created_at)
           ORDER BY date ASC`
          );
        }
      } else {
        // Regular users can only view their own teachers' analytics
        if (year) {
          [rows] = await pool.query(
            `SELECT DATE(created_at) as date, COUNT(*) as count
           FROM teachers
           WHERE user_id = $1 AND EXTRACT(YEAR FROM created_at) = $2 AND created_at >= (CURRENT_DATE - INTERVAL '30 days')
           GROUP BY DATE(created_at)
           ORDER BY date ASC`,
            [userId, year]
          );
        } else {
          [rows] = await pool.query(
            `SELECT DATE(created_at) as date, COUNT(*) as count
           FROM teachers
           WHERE user_id = $1 AND created_at >= (CURRENT_DATE - INTERVAL '30 days')
           GROUP BY DATE(created_at)
           ORDER BY date ASC`,
            [userId]
          );
        }
      }
      res.json(rows);
    } catch (error) {
      console.error("Error fetching teacher analytics:", error);
      res.status(500).json({
        error: "Error fetching teacher analytics",
        details: error.message,
      });
    }
  }
);
// FEES & ID CARDS ENDPOINTS
// 1. Search students for auto-suggest
app.get("/api/students/search", authenticateToken, async (req, res) => {
  const query = req.query.query || "";
  try {
    // All users can search all students by name or student_id
    const result = await pool.query(
      "SELECT id, full_name, student_id FROM students WHERE LOWER(full_name) LIKE LOWER($1) OR LOWER(student_id) LIKE LOWER($1) ORDER BY full_name ASC LIMIT 10",
      [`%${query}%`]
    );
    console.log(
      `[SEARCH DEBUG] Query: '${query}', Found: ${result.rows.length}`
    );
    if (result.rows.length > 0) {
      console.log("[SEARCH DEBUG] Results:", result.rows);
    }
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: "Error searching students" });
  }
});
// Add this before startServer or before catch-all
app.get("/api/fees/total/yearly", authenticateToken, async (req, res) => {
  const userId = req.user.id;
  const userRole = req.user.role;
  const year = req.query.year ? parseInt(req.query.year) : null;
  try {
    let result;
    if (userRole === "admin") {
      // Admin can view total fees for all students
      if (year) {
        result = await pool.query(
          `SELECT SUM(amount) as total
           FROM fees f
           WHERE EXTRACT(YEAR FROM f.paid_at) = $1`,
          [year]
        );
      } else {
        result = await pool.query(
          `SELECT SUM(amount) as total
           FROM fees f
           WHERE EXTRACT(YEAR FROM f.paid_at) = EXTRACT(YEAR FROM CURRENT_DATE)`
        );
      }
    } else {
      // Regular users can only view their own students' fees
      if (year) {
        result = await pool.query(
          `SELECT SUM(amount) as total
           FROM fees f
           JOIN students s ON f.student_id = s.id
           WHERE s.user_id = $1 AND EXTRACT(YEAR FROM f.paid_at) = $2`,
          [userId, year]
        );
      } else {
        result = await pool.query(
          `SELECT SUM(amount) as total
           FROM fees f
           JOIN students s ON f.student_id = s.id
           WHERE s.user_id = $1 AND EXTRACT(YEAR FROM f.paid_at) = EXTRACT(YEAR FROM CURRENT_DATE)`,
          [userId]
        );
      }
    }
    const total = result.rows[0]?.total || 0;
    res.json({ total });
  } catch (error) {
    console.error("Error fetching yearly total fees:", error);
    res.status(500).json({
      error: "Error fetching yearly total fees",
      details: error.message,
    });
  }
});
app.get("/api/student/:id/fees", authenticateToken, async (req, res) => {
  const userId = req.user.id;
  const userRole = req.user.role;
  const studentId = req.params.id;
  const year = req.query.year ? parseInt(req.query.year) : null;
  console.log(
    `[FEE STATS DEBUG] Fetching stats for studentId: ${studentId}, userId: ${userId}, role: ${userRole}`
  );
  try {
    // Get student and class with role-based access
    let resultStudent;
    if (
      userRole === "admin" ||
      userRole === "Admin3" ||
      userRole === "Admin2" ||
      userRole === "Admin1" ||
      userRole === "Admin4"
    ) {
      // Admins can view fees for any student
      resultStudent = await pool.query(
        "SELECT s.*, c.name as class_name, c.registration_fee, c.bus_fee, c.internship_fee, c.remedial_fee, c.tuition_fee, c.pta_fee FROM students s JOIN classes c ON s.class_id = c.id WHERE s.id = $1",
        [studentId]
      );
    } else {
      // Regular users can only view their own students' fees
      resultStudent = await pool.query(
        "SELECT s.*, c.name as class_name, c.registration_fee, c.bus_fee, c.internship_fee, c.remedial_fee, c.tuition_fee, c.pta_fee FROM students s JOIN classes c ON s.class_id = c.id WHERE s.id = $1 AND s.user_id = $2",
        [studentId, userId]
      );
    }
    const student = resultStudent.rows[0];
    if (!student) {
      console.warn(`[FEE STATS DEBUG] Student not found for id: ${studentId}`);
      return res.status(404).json({ error: "Student not found" });
    }
    // Get all fees paid
    let resultFees;
    if (year) {
      resultFees = await pool.query(
        "SELECT fee_type, SUM(amount) as paid FROM fees WHERE student_id = $1 AND EXTRACT(YEAR FROM paid_at) = $2 GROUP BY fee_type",
        [studentId, year]
      );
    } else {
      resultFees = await pool.query(
        "SELECT fee_type, SUM(amount) as paid FROM fees WHERE student_id = $1 GROUP BY fee_type",
        [studentId]
      );
    }
    // Calculate balances
    const feeMap = Object.fromEntries(
      resultFees.rows.map((f) => [f.fee_type, parseFloat(f.paid)])
    );
    const balance = {
      Registration: Math.max(
        0,
        parseFloat(student.registration_fee) - (feeMap["Registration"] || 0)
      ),
      Bus: Math.max(0, parseFloat(student.bus_fee) - (feeMap["Bus"] || 0)),
      Internship: Math.max(
        0,
        parseFloat(student.internship_fee) - (feeMap["Internship"] || 0)
      ),
      Remedial: Math.max(
        0,
        parseFloat(student.remedial_fee) - (feeMap["Remedial"] || 0)
      ),
      Tuition: Math.max(
        0,
        parseFloat(student.tuition_fee) - (feeMap["Tuition"] || 0)
      ),
      PTA: Math.max(0, parseFloat(student.pta_fee) - (feeMap["PTA"] || 0)),
    };
    console.log(
      `[FEE STATS DEBUG] Returning stats for studentId: ${studentId}`,
      { student, balance }
    );
    res.json({ student, balance });
  } catch (error) {
    console.error(
      "[FEE STATS DEBUG] Error fetching student fee stats:",
      error.stack
    );
    res
      .status(500)
      .json({ error: "Error fetching student fees", details: error.message });
  }
});
app.post("/api/fees", authenticateToken, async (req, res) => {
  const userId = req.user.id;
  const { student_id, class_id, fee_type, amount, paid_at } = req.body;
  try {
    // Optionally: check if student belongs to user
    if (paid_at) {
      await pool.query(
        "INSERT INTO fees (student_id, class_id, fee_type, amount, paid_at) VALUES ($1, $2, $3, $4, $5)",
        [student_id, class_id, fee_type, amount, paid_at]
      );
    } else {
      await pool.query(
        "INSERT INTO fees (student_id, class_id, fee_type, amount) VALUES ($1, $2, $3, $4)",
        [student_id, class_id, fee_type, amount]
      );
    }
    res.json({ message: "Fee payment recorded" });
  } catch (error) {
    res.status(500).json({ error: "Error recording fee payment" });
  }
});
app.get("/api/fees/class/:classId", authenticateToken, async (req, res) => {
  const userId = req.user.id;
  const userRole = req.user.role;
  const classId = req.params.classId;
  const year = req.query.year ? parseInt(req.query.year) : null;
  try {
    // First, check if the class exists
    const classCheck = await pool.query(
      "SELECT id, name, user_id FROM classes WHERE id = $1",
      [classId]
    );
    if (classCheck.rows.length === 0) {
      console.log(`[FEE DEBUG] Class with ID ${classId} not found.`);
      return res
        .status(404)
        .json({ error: `Class with ID ${classId} not found` });
    }
    const className = classCheck.rows[0].name;
    console.log(`[FEE DEBUG] ClassId: ${classId}, ClassName: ${className}`);
    // Get all students in class with role-based access
    let resultStudents;
    if (userRole === "admin") {
      resultStudents = await pool.query(
        "SELECT s.id, s.full_name, s.user_id, c.registration_fee, c.bus_fee, c.internship_fee, c.remedial_fee, c.tuition_fee, c.pta_fee FROM students s JOIN classes c ON s.class_id = c.id WHERE s.class_id = $1",
        [classId]
      );
    } else {
      resultStudents = await pool.query(
        "SELECT s.id, s.full_name, s.user_id, c.registration_fee, c.bus_fee, c.internship_fee, c.remedial_fee, c.tuition_fee, c.pta_fee FROM students s JOIN classes c ON s.class_id = c.id WHERE s.class_id = $1 AND s.user_id = $2",
        [classId, userId]
      );
    }
    const students = resultStudents.rows;
    console.log(
      `[FEE DEBUG] Found ${students.length} students in class ${className} (ID: ${classId})`
    );
    if (students.length > 0) {
      console.log(
        "[FEE DEBUG] Student IDs:",
        students.map((s) => s.id)
      );
    }
    if (students.length === 0) {
      return res.json([]);
    }
    // Get all fees for these students
    const studentIds = students.map((s) => s.id);
    let fees = [];
    if (studentIds.length > 0) {
      const placeholders = studentIds.map((_, i) => `$${i + 1}`).join(",");
      if (year) {
        const params = [...studentIds, year];
        const query = `SELECT student_id, fee_type, SUM(amount) as paid FROM fees WHERE student_id IN (${placeholders}) AND EXTRACT(YEAR FROM paid_at) = $${
          studentIds.length + 1
        } GROUP BY student_id, fee_type`;
        const resultFees = await pool.query(query, params);
        fees = resultFees.rows;
      } else {
        const query = `SELECT student_id, fee_type, SUM(amount) as paid FROM fees WHERE student_id IN (${placeholders}) GROUP BY student_id, fee_type`;
        const resultFees = await pool.query(query, studentIds);
        fees = resultFees.rows;
      }
    }
    // Map fees by student
    const feeMap = {};
    for (const f of fees) {
      if (!feeMap[f.student_id]) feeMap[f.student_id] = {};
      feeMap[f.student_id][f.fee_type] = parseFloat(f.paid);
    }
    // Build stats
    const stats = students.map((s) => {
      const paid = feeMap[s.id] || {};
      const reg = parseFloat(s.registration_fee) || 0;
      const bus = parseFloat(s.bus_fee) || 0;
      const intern = parseFloat(s.internship_fee) || 0;
      const remedial = parseFloat(s.remedial_fee) || 0;
      const tuition = parseFloat(s.tuition_fee) || 0;
      const pta = parseFloat(s.pta_fee) || 0;
      const total = reg + bus + intern + remedial + tuition + pta;
      const paidReg = paid["Registration"] || 0;
      const paidBus = paid["Bus"] || 0;
      const paidIntern = paid["Internship"] || 0;
      const paidRemedial = paid["Remedial"] || 0;
      const paidTuition = paid["Tuition"] || 0;
      const paidPTA = paid["PTA"] || 0;
      const paidTotal =
        paidReg + paidBus + paidIntern + paidRemedial + paidTuition + paidPTA;
      return {
        name: s.full_name,
        Registration: paidReg,
        Bus: paidBus,
        Internship: paidIntern,
        Remedial: paidRemedial,
        Tuition: paidTuition,
        PTA: paidPTA,
        Total: paidTotal,
        Balance: Math.max(0, total - paidTotal),
        Status: paidTotal >= total ? "Paid" : "Owing",
      };
    });
    console.log("[FEE DEBUG] Fee stats to return:", stats);
    res.json(stats);
  } catch (error) {
    console.error("Error in /api/fees/class/:classId:", error);
    res.status(500).json({
      error: "Error fetching class fee stats",
      details: error.message,
    });
  }
});
function verifyDatabaseStructure() {
  return new Promise((resolve, reject) => {
    const requiredTables = [
      "users",
      "students",
      "classes",
      "vocational",
      "teachers",
      "fees",
      "id_cards",
      "lesson_plans",
      "subjects",
    ];
    const checkTable = (tableName) => {
      return new Promise((resolveTable, rejectTable) => {
        pool.query(
          `SELECT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = $1)`,
          [tableName],
          (err, result) => {
            if (err) {
              console.error(`Error checking table ${tableName}:`, err);
              rejectTable(err);
            } else {
              if (result.rows[0].exists) {
                console.log(`Table ${tableName} exists`);
                resolveTable(true);
              } else {
                console.log(`Table ${tableName} does not exist`);
                resolveTable(false);
              }
            }
          }
        );
      });
    };
    Promise.all(requiredTables.map(checkTable))
      .then((results) => {
        const allTablesExist = results.every((exists) => exists);
        if (allTablesExist) {
          console.log("All required tables exist");
          resolve(true);
        } else {
          console.log("Some required tables are missing");
          resolve(false);
        }
      })
      .catch(reject);
  });
}
async function runMigrations() {
  try {
    console.log("Running migrations...");
    // Check if class_id column exists
    const result = await pool.query(
      "SELECT column_name FROM information_schema.columns WHERE table_name = 'students' AND column_name = 'class_id'"
    );
    const columns = result.rows;
    if (columns.length === 0) {
      console.log("Adding class_id column to students table...");
      await pool.query("ALTER TABLE students ADD COLUMN class_id INT");
      // Add foreign key constraint
      await pool.query(
        "ALTER TABLE students ADD CONSTRAINT students_ibfk_2 FOREIGN KEY (class_id) REFERENCES classes(id) ON DELETE SET NULL"
      );
      console.log("class_id column and foreign key added successfully");
    } else {
      console.log("class_id column already exists");
    }
    // Assign first available class to students with NULL class_id
    const classResult = await pool.query("SELECT id FROM classes LIMIT 1");
    const classes = classResult.rows;
    if (classes.length > 0) {
      const classId = classes[0].id;
      const updateResult = await pool.query(
        "UPDATE students SET class_id = $1 WHERE class_id IS NULL",
        [classId]
      );
      console.log(
        `Assigned class_id=${classId} to ${updateResult.rowCount} students with NULL class_id.`
      );
    }
    // Check if messages table has file attachment columns
    const messagesColumns = await pool.query(
      "SELECT column_name FROM information_schema.columns WHERE table_name = 'messages' AND column_name IN ('file_url', 'file_name', 'file_type')"
    );
    const existingFileColumns = messagesColumns.rows.map(
      (row) => row.column_name
    );
    if (!existingFileColumns.includes("file_url")) {
      console.log("Adding file_url column to messages table...");
      await pool.query("ALTER TABLE messages ADD COLUMN file_url VARCHAR(255)");
    }
    if (!existingFileColumns.includes("file_name")) {
      console.log("Adding file_name column to messages table...");
      await pool.query(
        "ALTER TABLE messages ADD COLUMN file_name VARCHAR(255)"
      );
    }
    if (!existingFileColumns.includes("file_type")) {
      console.log("Adding file_type column to messages table...");
      await pool.query("ALTER TABLE messages ADD COLUMN file_type VARCHAR(50)");
    }
    // Check if messages table has group_id column
    const groupIdColumn = await pool.query(
      "SELECT column_name FROM information_schema.columns WHERE table_name = 'messages' AND column_name = 'group_id'"
    );
    if (groupIdColumn.rows.length === 0) {
      console.log("Adding group_id column to messages table...");
      await pool.query("ALTER TABLE messages ADD COLUMN group_id INTEGER");
    }
    // Check if groups table exists
    const groupsTable = await pool.query(
      "SELECT table_name FROM information_schema.tables WHERE table_name = 'groups'"
    );
    if (groupsTable.rows.length === 0) {
      console.log("Creating groups table...");
      await pool.query(`
        CREATE TABLE groups (
          id SERIAL PRIMARY KEY,
          name VARCHAR(100) NOT NULL,
          creator_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `);
    }
    // Check if group_participants table exists
    const groupParticipantsTable = await pool.query(
      "SELECT table_name FROM information_schema.tables WHERE table_name = 'group_participants'"
    );
    if (groupParticipantsTable.rows.length === 0) {
      console.log("Creating group_participants table...");
      await pool.query(`
        CREATE TABLE group_participants (
          id SERIAL PRIMARY KEY,
          group_id INTEGER REFERENCES groups(id) ON DELETE CASCADE,
          user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
          joined_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          UNIQUE(group_id, user_id)
        )
      `);
    }
    // Check if inventory table exists
    const inventoryTable = await pool.query(
      "SELECT table_name FROM information_schema.tables WHERE table_name = 'inventory'"
    );
    if (inventoryTable.rows.length === 0) {
      console.log("Creating inventory table...");
      await pool.query(`
        CREATE TABLE inventory (
          id SERIAL PRIMARY KEY,
          date DATE NOT NULL,
          item_name VARCHAR(255) NOT NULL,
          department VARCHAR(255) NOT NULL,
          quantity INTEGER NOT NULL,
          estimated_cost NUMERIC(12,2) NOT NULL,
          type VARCHAR(20) NOT NULL,
          depreciation_rate NUMERIC(5,2),
          created_at TIMESTAMP DEFAULT NOW(),
          updated_at TIMESTAMP DEFAULT NOW()
        )
      `);
    }
    // Check if subjects table exists and has all required columns
    const subjectsTable = await pool.query(
      "SELECT table_name FROM information_schema.tables WHERE table_name = 'subjects'"
    );
    if (subjectsTable.rows.length === 0) {
      console.log("Creating subjects table...");
      await pool.query(`
        CREATE TABLE subjects (
          id SERIAL PRIMARY KEY,
          name VARCHAR(255) NOT NULL,
          code VARCHAR(50) UNIQUE,
          description TEXT,
          credits INTEGER DEFAULT 0,
          department VARCHAR(100),
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `);
    } else {
      // Check if subjects table has all required columns
      const subjectsColumns = await pool.query(
        "SELECT column_name FROM information_schema.columns WHERE table_name = 'subjects' AND column_name IN ('description', 'credits', 'department', 'updated_at')"
      );
      const existingSubjectsColumns = subjectsColumns.rows.map(
        (row) => row.column_name
      );
      if (!existingSubjectsColumns.includes("description")) {
        console.log("Adding description column to subjects table...");
        await pool.query("ALTER TABLE subjects ADD COLUMN description TEXT");
      }
      if (!existingSubjectsColumns.includes("credits")) {
        console.log("Adding credits column to subjects table...");
        await pool.query(
          "ALTER TABLE subjects ADD COLUMN credits INTEGER DEFAULT 0"
        );
      }
      if (!existingSubjectsColumns.includes("department")) {
        console.log("Adding department column to subjects table...");
        await pool.query(
          "ALTER TABLE subjects ADD COLUMN department VARCHAR(100)"
        );
      }
      if (!existingSubjectsColumns.includes("updated_at")) {
        console.log("Adding updated_at column to subjects table...");
        await pool.query(
          "ALTER TABLE subjects ADD COLUMN updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP"
        );
      }
    }
    // Check if subject_classifications table exists
    const subjectClassificationsTable = await pool.query(
      "SELECT table_name FROM information_schema.tables WHERE table_name = 'subject_classifications'"
    );
    if (subjectClassificationsTable.rows.length === 0) {
      console.log("Creating subject_classifications table...");
      await pool.query(`
        CREATE TABLE subject_classifications (
          id SERIAL PRIMARY KEY,
          class_id INTEGER REFERENCES classes(id) ON DELETE CASCADE,
          subject_id INTEGER REFERENCES subjects(id) ON DELETE CASCADE,
          classification_type VARCHAR(20) NOT NULL CHECK (classification_type IN ('general', 'professional')),
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          UNIQUE(class_id, subject_id)
        )
      `);
    }
    // Check if subject_coefficients table exists
    const subjectCoefficientsTable = await pool.query(
      "SELECT table_name FROM information_schema.tables WHERE table_name = 'subject_coefficients'"
    );
    if (subjectCoefficientsTable.rows.length === 0) {
      console.log("Creating subject_coefficients table...");
      await pool.query(`
        CREATE TABLE subject_coefficients (
          id SERIAL PRIMARY KEY,
          class_id INTEGER REFERENCES classes(id) ON DELETE CASCADE,
          subject_id INTEGER REFERENCES subjects(id) ON DELETE CASCADE,
          coefficient DECIMAL(4,2) NOT NULL DEFAULT 1.00,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          UNIQUE(class_id, subject_id)
        )
      `);
    }
    // Check if lesson_plans table exists and has all required columns
    const lessonPlansTable = await pool.query(
      "SELECT table_name FROM information_schema.tables WHERE table_name = 'lesson_plans'"
    );
    if (lessonPlansTable.rows.length === 0) {
      console.log("Creating lesson_plans table...");
      await pool.query(`
        CREATE TABLE lesson_plans (
          id SERIAL PRIMARY KEY,
          user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
          title VARCHAR(255) NOT NULL,
          subject VARCHAR(100),
          class_name VARCHAR(100),
          week VARCHAR(50),
          objectives TEXT,
          content TEXT,
          activities TEXT,
          assessment TEXT,
          resources TEXT,
          file_url VARCHAR(255),
          file_name VARCHAR(255),
          status VARCHAR(20) DEFAULT 'pending',
          admin_comment TEXT,
          period_type VARCHAR(50) DEFAULT 'weekly',
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `);
    } else {
      // Check if lesson_plans table has all required columns
      const lessonPlansColumns = await pool.query(
        "SELECT column_name FROM information_schema.columns WHERE table_name = 'lesson_plans' AND column_name IN ('subject', 'class_name', 'week', 'objectives', 'content', 'activities', 'assessment', 'resources', 'file_url', 'file_name', 'status', 'admin_comment', 'updated_at', 'period_type')"
      );
      const existingLessonPlansColumns = lessonPlansColumns.rows.map(
        (row) => row.column_name
      );
      if (!existingLessonPlansColumns.includes("subject")) {
        console.log("Adding subject column to lesson_plans table...");
        await pool.query(
          "ALTER TABLE lesson_plans ADD COLUMN subject VARCHAR(100)"
        );
      }
      if (!existingLessonPlansColumns.includes("class_name")) {
        console.log("Adding class_name column to lesson_plans table...");
        await pool.query(
          "ALTER TABLE lesson_plans ADD COLUMN class_name VARCHAR(100)"
        );
      }
      if (!existingLessonPlansColumns.includes("week")) {
        console.log("Adding week column to lesson_plans table...");
        await pool.query(
          "ALTER TABLE lesson_plans ADD COLUMN week VARCHAR(50)"
        );
      }
      if (!existingLessonPlansColumns.includes("objectives")) {
        console.log("Adding objectives column to lesson_plans table...");
        await pool.query("ALTER TABLE lesson_plans ADD COLUMN objectives TEXT");
      }
      if (!existingLessonPlansColumns.includes("content")) {
        console.log("Adding content column to lesson_plans table...");
        await pool.query("ALTER TABLE lesson_plans ADD COLUMN content TEXT");
      }
      if (!existingLessonPlansColumns.includes("activities")) {
        console.log("Adding activities column to lesson_plans table...");
        await pool.query("ALTER TABLE lesson_plans ADD COLUMN activities TEXT");
      }
      if (!existingLessonPlansColumns.includes("assessment")) {
        console.log("Adding assessment column to lesson_plans table...");
        await pool.query("ALTER TABLE lesson_plans ADD COLUMN assessment TEXT");
      }
      if (!existingLessonPlansColumns.includes("resources")) {
        console.log("Adding resources column to lesson_plans table...");
        await pool.query("ALTER TABLE lesson_plans ADD COLUMN resources TEXT");
      }
      if (!existingLessonPlansColumns.includes("file_url")) {
        console.log("Adding file_url column to lesson_plans table...");
        await pool.query(
          "ALTER TABLE lesson_plans ADD COLUMN file_url VARCHAR(255)"
        );
      }
      if (!existingLessonPlansColumns.includes("file_name")) {
        console.log("Adding file_name column to lesson_plans table...");
        await pool.query(
          "ALTER TABLE lesson_plans ADD COLUMN file_name VARCHAR(255)"
        );
      }
      if (!existingLessonPlansColumns.includes("status")) {
        console.log("Adding status column to lesson_plans table...");
        await pool.query(
          "ALTER TABLE lesson_plans ADD COLUMN status VARCHAR(20) DEFAULT 'pending'"
        );
      }
      if (!existingLessonPlansColumns.includes("admin_comment")) {
        console.log("Adding admin_comment column to lesson_plans table...");
        await pool.query(
          "ALTER TABLE lesson_plans ADD COLUMN admin_comment TEXT"
        );
      }
      if (!existingLessonPlansColumns.includes("updated_at")) {
        console.log("Adding updated_at column to lesson_plans table...");
        await pool.query(
          "ALTER TABLE lesson_plans ADD COLUMN updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP"
        );
      }
      if (!existingLessonPlansColumns.includes("period_type")) {
        console.log("Adding period_type column to lesson_plans table...");
        await pool.query(
          "ALTER TABLE lesson_plans ADD COLUMN period_type VARCHAR(50) DEFAULT 'weekly'"
        );
      }
    }
    // Check if students table has photo_url column
    const photoUrlColumn = await pool.query(
      "SELECT column_name FROM information_schema.columns WHERE table_name = 'students' AND column_name = 'photo_url'"
    );
    if (photoUrlColumn.rows.length === 0) {
      console.log("Adding photo_url column to students table...");
      await pool.query(
        "ALTER TABLE students ADD COLUMN photo_url VARCHAR(255)"
      );
      console.log("photo_url column added to students table successfully");
    } else {
      console.log("photo_url column already exists in students table");
    }
    // Check if applications table exists
    const applicationsTable = await pool.query(
      "SELECT table_name FROM information_schema.tables WHERE table_name = 'applications'"
    );
    if (applicationsTable.rows.length === 0) {
      console.log("Creating applications table...");
      await pool.query(`
        CREATE TABLE applications (
          id SERIAL PRIMARY KEY,
          applicant_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
          applicant_name VARCHAR(100) NOT NULL,
          classes TEXT NOT NULL, -- Comma-separated class names
          subjects TEXT NOT NULL, -- Comma-separated subject names
          contact VARCHAR(50) NOT NULL,
          certificate_url VARCHAR(500),
          certificate_name VARCHAR(255),
          status VARCHAR(20) DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
          admin_comment TEXT,
          submitted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          reviewed_at TIMESTAMP,
          reviewed_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
          UNIQUE(applicant_id) -- Ensure only one application per user
        )
      `);
      console.log("Applications table created successfully");
    } else {
      console.log("Applications table already exists");
    }
    console.log("Messages table file attachment columns migration completed");
  } catch (error) {
    console.error("Error running migrations:", error);
    throw error;
  }
}
// Add this before startServer
const initializeDatabase = async () => {
  try {
    console.log("Initializing database tables...");
    // Example: create all required tables if not exist
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        username VARCHAR(100) UNIQUE NOT NULL,
        password VARCHAR(255) NOT NULL,
        email VARCHAR(100),
        contact VARCHAR(50),
        is_default BOOLEAN DEFAULT false,
        role VARCHAR(50),
        name VARCHAR(100),
        gender VARCHAR(20),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS classes (
        id SERIAL PRIMARY KEY,
        user_id INTEGER,
        name VARCHAR(100) NOT NULL,
        registration_fee VARCHAR(50),
        bus_fee VARCHAR(50),
        internship_fee VARCHAR(50),
        remedial_fee VARCHAR(50),
        tuition_fee VARCHAR(50),
        pta_fee VARCHAR(50),
        total_fee VARCHAR(50),
        number_of_installments INTEGER,
        year VARCHAR(20),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS students (
        id SERIAL PRIMARY KEY,
        student_id VARCHAR(32) UNIQUE,
        user_id INTEGER,
        full_name VARCHAR(100) NOT NULL,
        sex VARCHAR(10),
        date_of_birth DATE,
        place_of_birth VARCHAR(100),
        father_name VARCHAR(100),
        mother_name VARCHAR(100),
        class_id INTEGER,
        vocational_training VARCHAR(100),
        guardian_contact VARCHAR(50),
        student_picture BYTEA,
        year VARCHAR(20),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS vocational (
        id SERIAL PRIMARY KEY,
        user_id INTEGER,
        name VARCHAR(100),
        description TEXT,
        picture1 VARCHAR(255),
        picture2 VARCHAR(255),
        picture3 VARCHAR(255),
        picture4 VARCHAR(255),
        year VARCHAR(20),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS teachers (
        id SERIAL PRIMARY KEY,
        user_id INTEGER,
        teacher_name VARCHAR(100),
        subjects TEXT,
        id_card VARCHAR(100),
        classes_taught TEXT,
        status VARCHAR(20) DEFAULT 'pending',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS id_cards (
        id SERIAL PRIMARY KEY,
        student_id INTEGER,
        card_number VARCHAR(100),
        issued_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS fees (
        id SERIAL PRIMARY KEY,
        student_id INTEGER,
        class_id INTEGER,
        fee_type VARCHAR(50),
        amount NUMERIC,
        paid_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS messages (
        id SERIAL PRIMARY KEY,
        sender_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        receiver_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        group_id INTEGER,
        content TEXT NOT NULL,
        file_url VARCHAR(255),
        file_name VARCHAR(255),
        file_type VARCHAR(50),
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        read BOOLEAN DEFAULT FALSE
      );
      CREATE TABLE IF NOT EXISTS groups (
        id SERIAL PRIMARY KEY,
        name VARCHAR(100) NOT NULL,
        creator_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
      CREATE TABLE IF NOT EXISTS group_participants (
        id SERIAL PRIMARY KEY,
        group_id INTEGER REFERENCES groups(id) ON DELETE CASCADE,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        joined_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(group_id, user_id)
      );
      CREATE TABLE IF NOT EXISTS inventory (
        id SERIAL PRIMARY KEY,
        date DATE NOT NULL,
        item_name VARCHAR(255) NOT NULL,
        department VARCHAR(255) NOT NULL,
        quantity INTEGER NOT NULL,
        estimated_cost NUMERIC(12,2) NOT NULL,
        type VARCHAR(20) NOT NULL,
        depreciation_rate NUMERIC(5,2),
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      );
      CREATE TABLE IF NOT EXISTS lesson_plans (
        id SERIAL PRIMARY KEY,
        user_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
        title VARCHAR(255) NOT NULL,
        subject VARCHAR(100),
        class_name VARCHAR(100),
        week VARCHAR(50),
        objectives TEXT,
        content TEXT,
        activities TEXT,
        assessment TEXT,
        resources TEXT,
        file_url VARCHAR(255),
        file_name VARCHAR(255),
        status VARCHAR(20) DEFAULT 'pending',
        admin_comment TEXT,
        period_type VARCHAR(50) DEFAULT 'weekly',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
      -- Timetables
      CREATE TABLE IF NOT EXISTS timetables (
          id SERIAL PRIMARY KEY,
          class_id INTEGER REFERENCES classes(id) ON DELETE CASCADE,
          data JSONB NOT NULL,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
      -- Timetable Settings
      CREATE TABLE IF NOT EXISTS timetable_settings (
          id SERIAL PRIMARY KEY,
          working_days TEXT[] NOT NULL DEFAULT ARRAY['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday'],
          periods_per_day INTEGER NOT NULL DEFAULT 8,
          period_duration INTEGER NOT NULL DEFAULT 45,
          break_duration INTEGER NOT NULL DEFAULT 15,
          lunch_duration INTEGER NOT NULL DEFAULT 60,
          start_time TIME NOT NULL DEFAULT '08:00',
          end_time TIME NOT NULL DEFAULT '16:00',
          break_time TIME NOT NULL DEFAULT '10:30',
          lunch_time TIME NOT NULL DEFAULT '12:00',
          constraints JSONB NOT NULL DEFAULT '{"noSameTeacherSamePeriod": true, "noTeacherOverlap": true, "spreadSubjects": true, "respectBreakTimes": true}',
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
      -- Teacher Subject Class Assignments
      CREATE TABLE IF NOT EXISTS teacher_assignments (
          id SERIAL PRIMARY KEY,
          teacher_id INTEGER REFERENCES users(id) ON DELETE CASCADE,
          class_id INTEGER REFERENCES classes(id) ON DELETE CASCADE,
          subject_id INTEGER REFERENCES subjects(id) ON DELETE CASCADE,
          periods_per_week INTEGER NOT NULL DEFAULT 1,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          UNIQUE(teacher_id, class_id, subject_id)
      );
      -- Timetable Generation Sessions
      CREATE TABLE IF NOT EXISTS timetable_sessions (
          id SERIAL PRIMARY KEY,
          session_name VARCHAR(255) NOT NULL,
          settings_id INTEGER REFERENCES timetable_settings(id) ON DELETE SET NULL,
          classes_included INTEGER[] NOT NULL,
          teachers_included INTEGER[] NOT NULL,
          status VARCHAR(20) NOT NULL DEFAULT 'generated' CHECK (status IN ('generating', 'generated', 'failed')),
          generated_timetables INTEGER[] NOT NULL,
          generation_notes TEXT,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          completed_at TIMESTAMP
      );
      -- Salary Descriptions for Pay Slips
      CREATE TABLE IF NOT EXISTS salary_descriptions (
          id SERIAL PRIMARY KEY,
          description VARCHAR(100) NOT NULL,
          percentage DECIMAL(5,2) NOT NULL CHECK (percentage >= 0 AND percentage <= 100),
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );`);
    console.log("All required tables created or already exist.");
    return true;
  } catch (err) {
    console.error("Error initializing database:", err);
    return false;
  }
};
console.log("--- server.js loaded ---");
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
    // Verify database structure
    const structureValid = await verifyDatabaseStructure();
    console.log("Database structure checked:", structureValid);
    if (!structureValid) {
      console.log("Database structure invalid, initializing...");
      const initSuccess = await initializeDatabase();
      console.log("Database initialized:", initSuccess);
      if (!initSuccess) {
        throw new Error("Failed to initialize database");
      }
    } else {
      // Run migrations even if structure is valid
      await runMigrations();
      console.log("Migrations complete");
    }
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
// === Specialties endpoints ===
// Create a new specialty
app.post("/api/specialties", async (req, res) => {
  const { name, abbreviation } = req.body;
  if (!name) {
    return res.status(400).json({ error: "Name is required" });
  }
  try {
    const result = await pool.query(
      "INSERT INTO specialties (name, abbreviation) VALUES ($1, $2) RETURNING *",
      [name, abbreviation || null]
    );
    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error("Error creating specialty:", error);
    res.status(500).json({ error: "Error creating specialty" });
  }
});
// Get all specialties (with assigned class_ids)
app.get("/api/specialties", async (req, res) => {
  try {
    // Get all specialties
    const result = await pool.query(
      "SELECT * FROM specialties ORDER BY created_at DESC"
    );
    const specialties = result.rows;
    // Get all assignments in one query
    const assignRes = await pool.query(
      "SELECT specialty_id, class_id FROM specialty_classes"
    );
    const assignments = assignRes.rows;
    // Map specialty_id to class_ids
    const classMap = {};
    assignments.forEach((a) => {
      if (!classMap[a.specialty_id]) classMap[a.specialty_id] = [];
      classMap[a.specialty_id].push(a.class_id);
    });
    // Attach class_ids to each specialty
    const specialtiesWithClasses = specialties.map((s) => ({
      ...s,
      class_ids: classMap[s.id] || [],
    }));
    res.json(specialtiesWithClasses);
  } catch (error) {
    console.error("Error fetching specialties:", error);
    res.status(500).json({ error: "Error fetching specialties" });
  }
});
// Update a specialty
app.put("/api/specialties/:id", async (req, res) => {
  const { id } = req.params;
  const { name, abbreviation } = req.body;
  if (!name) {
    return res.status(400).json({ error: "Name is required" });
  }
  try {
    const result = await pool.query(
      "UPDATE specialties SET name = $1, abbreviation = $2 WHERE id = $3 RETURNING *",
      [name, abbreviation || null, id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Specialty not found" });
    }
    res.json(result.rows[0]);
  } catch (error) {
    console.error("Error updating specialty:", error);
    res.status(500).json({ error: "Error updating specialty" });
  }
});
// Delete a specialty
app.delete("/api/specialties/:id", async (req, res) => {
  const { id } = req.params;
  try {
    const result = await pool.query(
      "DELETE FROM specialties WHERE id = $1 RETURNING *",
      [id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Specialty not found" });
    }
    res.json({ message: "Specialty deleted successfully" });
  } catch (error) {
    console.error("Error deleting specialty:", error);
    res.status(500).json({ error: "Error deleting specialty" });
  }
});
// === Specialty-Class assignment endpoints ===
// Assign one or more classes to a specialty
app.post("/api/specialties/:specialty_id/classes", async (req, res) => {
  const { specialty_id } = req.params;
  let { class_ids } = req.body;
  if (!Array.isArray(class_ids)) {
    // Accept single value as array
    class_ids = [class_ids];
  }
  if (!specialty_id || !class_ids || class_ids.length === 0) {
    return res
      .status(400)
      .json({ error: "specialty_id and class_ids are required" });
  }
  try {
    // Remove duplicates
    class_ids = [...new Set(class_ids.map(Number))];
    // Insert assignments, ignore duplicates
    const values = class_ids
      .map((cid) => `(${Number(specialty_id)}, ${Number(cid)})`)
      .join(",");
    await pool.query(
      `INSERT INTO specialty_classes (specialty_id, class_id)
       VALUES ${values}
       ON CONFLICT DO NOTHING`
    );
    res.json({ message: "Classes assigned to specialty successfully" });
  } catch (error) {
    console.error("Error assigning classes to specialty:", error);
    res.status(500).json({ error: "Error assigning classes to specialty" });
  }
});
// List all classes assigned to a specialty
app.get("/api/specialties/:specialty_id/classes", async (req, res) => {
  const { specialty_id } = req.params;
  try {
    const result = await pool.query(
      `SELECT c.* FROM classes c
       INNER JOIN specialty_classes sc ON c.id = sc.class_id
       WHERE sc.specialty_id = $1
       ORDER BY c.name ASC`,
      [specialty_id]
    );
    res.json(result.rows);
  } catch (error) {
    console.error("Error fetching classes for specialty:", error);
    res.status(500).json({ error: "Error fetching classes for specialty" });
  }
});
// Remove a class from a specialty
app.delete(
  "/api/specialties/:specialty_id/classes/:class_id",
  async (req, res) => {
    const { specialty_id, class_id } = req.params;
    try {
      const result = await pool.query(
        "DELETE FROM specialty_classes WHERE specialty_id = $1 AND class_id = $2 RETURNING *",
        [specialty_id, class_id]
      );
      if (result.rows.length === 0) {
        return res.status(404).json({ error: "Assignment not found" });
      }
      res.json({ message: "Class removed from specialty successfully" });
    } catch (error) {
      console.error("Error removing class from specialty:", error);
      res.status(500).json({ error: "Error removing class from specialty" });
    }
  }
);
// Assign classes to a specialty
app.put("/api/specialties/:id/classes", async (req, res) => {
  const specialtyId = req.params.id;
  const { classIds } = req.body; // expects array of class IDs
  if (!Array.isArray(classIds)) {
    return res.status(400).json({ error: "classIds must be an array" });
  }
  try {
    // Remove existing assignments
    await pool.query("DELETE FROM specialty_classes WHERE specialty_id = $1", [
      specialtyId,
    ]);
    // Insert new assignments
    for (const classId of classIds) {
      await pool.query(
        "INSERT INTO specialty_classes (specialty_id, class_id) VALUES ($1, $2)",
        [specialtyId, classId]
      );
    }
    res.json({ message: "Classes assigned to specialty successfully" });
  } catch (error) {
    console.error("Error assigning classes to specialty:", error);
    res.status(500).json({
      error: "Error assigning classes to specialty",
      details: error.message,
    });
  }
});
// Get assigned classes for a specialty
app.get("/api/specialties/:id/classes", async (req, res) => {
  const specialtyId = req.params.id;
  try {
    const result = await pool.query(
      "SELECT class_id FROM specialty_classes WHERE specialty_id = $1",
      [specialtyId]
    );
    const classIds = result.rows.map((r) => r.class_id);
    res.json(classIds);
  } catch (error) {
    console.error("Error fetching assigned classes for specialty:", error);
    res.status(500).json({
      error: "Error fetching assigned classes for specialty",
      details: error.message,
    });
  }
});
// Serve student image from DB
app.get("/api/students/:id/picture", async (req, res) => {
  const studentId = req.params.id;
  try {
    const result = await pool.query(
      "SELECT student_picture, photo_url FROM students WHERE id = $1",
      [studentId]
    );
    if (result.rows.length === 0) {
      console.warn(`[IMAGE] No student found for ID: ${studentId}`);
      return res.status(404).send("No student found");
    }
    const student = result.rows[0];
    // First try photo_url (new schema)
    if (student.photo_url) {
      console.log(`[IMAGE] Serving photo_url for student ID: ${studentId}`);
      // If it's a full URL, redirect to it
      if (student.photo_url.startsWith("http")) {
        return res.redirect(student.photo_url);
      }
      // If it's a local path, serve the file
      const fs = require("fs");
      const path = require("path");
      const filePath = path.join(__dirname, student.photo_url);
      if (fs.existsSync(filePath)) {
        return res.sendFile(filePath);
      }
    }
    // Fallback to student_picture (old schema - BYTEA)
    if (student.student_picture) {
      console.log(
        `[IMAGE] Serving student_picture for student ID: ${studentId}`
      );
      res.set("Content-Type", "image/jpeg");
      return res.send(student.student_picture);
    }
    console.warn(`[IMAGE] No image found for student ID: ${studentId}`);
    return res.status(404).send("No image");
  } catch (error) {
    console.error(
      `[IMAGE] Error retrieving image for student ID: ${studentId}:`,
      error
    );
    res.status(500).send("Error retrieving image");
  }
});
// Check user by username and phone number
app.post("/api/check-user-details", async (req, res) => {
  const { username, contact } = req.body;
  if (!username || !contact) {
    return res
      .status(400)
      .json({ error: "Username and phone number are required" });
  }
  try {
    const result = await pool.query(
      "SELECT * FROM users WHERE username = $1 AND contact = $2",
      [username, contact]
    );
    if (result.rows.length > 0) {
      return res.json({ exists: true });
    } else {
      return res.json({ exists: false });
    }
  } catch (error) {
    console.error("Error checking user details:", error);
    res.status(500).json({ error: "Server error" });
  }
});
// User management endpoints for Admin3
app.get("/api/users/all", authenticateToken, async (req, res) => {
  if (req.user.role !== "Admin3")
    return res.status(403).json({ error: "Forbidden" });
  try {
    const result = await pool.query(
      "SELECT id, name, username, contact, role, suspended FROM users ORDER BY created_at DESC"
    );
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch users" });
  }
});
app.put("/api/users/:id", authenticateToken, async (req, res) => {
  if (req.user.role !== "Admin3")
    return res.status(403).json({ error: "Forbidden" });
  const { id } = req.params;
  const { name, username, contact, password, role } = req.body;
  try {
    let updateFields = [
      "name = $1",
      "username = $2",
      "contact = $3",
      "role = $4",
    ];
    let updateValues = [name, username, contact, role];
    let paramIndex = 5;
    if (password) {
      const hashedPassword = await bcrypt.hash(password, 10);
      updateFields.push(`password = $${paramIndex}`);
      updateValues.push(hashedPassword);
      paramIndex++;
    }
    updateValues.push(id);
    const updateQuery = `UPDATE users SET ${updateFields.join(
      ", "
    )} WHERE id = $${paramIndex}`;
    await pool.query(updateQuery, updateValues);
    res.json({ message: "User updated" });
  } catch (error) {
    res.status(500).json({ error: "Failed to update user" });
  }
});
app.delete("/api/users/:id", authenticateToken, async (req, res) => {
  if (req.user.role !== "Admin3")
    return res.status(403).json({ error: "Forbidden" });
  const { id } = req.params;
  try {
    // Check if user is Admin3
    const userResult = await pool.query(
      "SELECT role FROM users WHERE id = $1",
      [id]
    );
    if (userResult.rows.length === 0) {
      return res.status(404).json({ error: "User not found" });
    }
    if (userResult.rows[0].role === "Admin3") {
      return res
        .status(403)
        .json({ error: "You cannot delete Accounts manager." });
    }
    await pool.query("DELETE FROM users WHERE id = $1", [id]);
    res.json({ message: "User deleted" });
  } catch (error) {
    res.status(500).json({ error: "Failed to delete user" });
  }
});
app.post("/api/users/:id/suspend", authenticateToken, async (req, res) => {
  if (req.user.role !== "Admin3")
    return res.status(403).json({ error: "Forbidden" });
  const { id } = req.params;
  try {
    // Toggle suspended status
    const result = await pool.query(
      "UPDATE users SET suspended = NOT COALESCE(suspended, false) WHERE id = $1 RETURNING suspended",
      [id]
    );
    if (result.rows.length === 0)
      return res.status(404).json({ error: "User not found" });
    res.json({ suspended: result.rows[0].suspended });
  } catch (error) {
    res.status(500).json({ error: "Failed to suspend user" });
  }
});
// Chat endpoints
app.get("/api/users/all-chat", authenticateToken, async (req, res) => {
  try {
    // Get all users except the current user for chat
    const result = await pool.query(
      "SELECT id, name, username, role, contact FROM users WHERE id != $1 AND suspended = false ORDER BY name",
      [req.user.id]
    );
    res.json(result.rows);
  } catch (error) {
    console.error("Error fetching users for chat:", error);
    res.status(500).json({ error: "Failed to fetch users for chat" });
  }
});
app.get("/api/users/chat-list", authenticateToken, async (req, res) => {
  try {
    // First get all users except current user
    const usersResult = await pool.query(
      "SELECT id, name, username, role, contact FROM users WHERE id != $1 AND suspended = false ORDER BY name",
      [req.user.id]
    );
    // Then get the last message for each conversation
    const lastMessagesResult = await pool.query(
      `
      SELECT
        CASE
          WHEN sender_id = $1 THEN receiver_id
          ELSE sender_id
        END as other_user_id,
        content as last_message,
        created_at as last_message_time,
        sender_id
      FROM messages
      WHERE sender_id = $1 OR receiver_id = $1
      ORDER BY created_at DESC
    `,
      [req.user.id]
    );
    // Get unread message counts for individual chats
    const unreadCountsResult = await pool.query(
      `
      SELECT
        sender_id,
        COUNT(*) as unread_count
      FROM messages
      WHERE receiver_id = $1 AND sender_id != $1 AND read = false
      GROUP BY sender_id
    `,
      [req.user.id]
    );
    // Create a map of unread counts by user
    const unreadCountsMap = {};
    unreadCountsResult.rows.forEach((row) => {
      unreadCountsMap[row.sender_id] = parseInt(row.unread_count);
    });
    // Create a map of last messages by user
    const lastMessagesMap = {};
    lastMessagesResult.rows.forEach((msg) => {
      if (
        !lastMessagesMap[msg.other_user_id] ||
        new Date(msg.last_message_time) >
          new Date(lastMessagesMap[msg.other_user_id].last_message_time)
      ) {
        lastMessagesMap[msg.other_user_id] = msg;
      }
    });
    // Combine user data with last message data
    const userChatList = usersResult.rows.map((user) => ({
      id: user.id,
      name: user.name,
      username: user.username,
      role: user.role,
      contact: user.contact,
      lastMessage: lastMessagesMap[user.id]
        ? {
            content: lastMessagesMap[user.id].last_message,
            time: lastMessagesMap[user.id].last_message_time,
            sender_id: lastMessagesMap[user.id].sender_id,
          }
        : null,
      unread: unreadCountsMap[user.id] || 0,
      type: "user",
    }));
    // Get groups that the current user is a member of
    const groupsResult = await pool.query(
      `
      SELECT g.*, u.username as creator_name
      FROM groups g
      JOIN users u ON g.creator_id = u.id
      WHERE g.id IN (
        SELECT group_id FROM group_participants WHERE user_id = $1
      )
      ORDER BY g.created_at DESC
    `,
      [req.user.id]
    );
    // Get last message for each group
    const groupMessagesResult = await pool.query(
      `
      SELECT
        group_id,
        content as last_message,
        created_at as last_message_time,
        sender_id
      FROM messages
      WHERE group_id IN (
        SELECT group_id FROM group_participants WHERE user_id = $1
      )
      ORDER BY created_at DESC
    `,
      [req.user.id]
    );
    // Get unread message counts for group chats
    const groupUnreadCountsResult = await pool.query(
      `
      SELECT
        group_id,
        COUNT(*) as unread_count
      FROM messages
      WHERE group_id IN (
        SELECT group_id FROM group_participants WHERE user_id = $1
      ) AND sender_id != $1 AND read = false
      GROUP BY group_id
    `,
      [req.user.id]
    );
    // Create a map of unread counts by group
    const groupUnreadCountsMap = {};
    groupUnreadCountsResult.rows.forEach((row) => {
      groupUnreadCountsMap[row.group_id] = parseInt(row.unread_count);
    });
    // Create a map of last messages by group
    const groupMessagesMap = {};
    groupMessagesResult.rows.forEach((msg) => {
      if (
        !groupMessagesMap[msg.group_id] ||
        new Date(msg.last_message_time) >
          new Date(groupMessagesMap[msg.group_id].last_message_time)
      ) {
        groupMessagesMap[msg.group_id] = msg;
      }
    });
    // Combine group data with last message data
    const groupChatList = groupsResult.rows.map((group) => ({
      id: group.id,
      name: group.name,
      groupName: group.name, // For compatibility with frontend
      creator_name: group.creator_name,
      lastMessage: groupMessagesMap[group.id]
        ? {
            content: groupMessagesMap[group.id].last_message,
            time: groupMessagesMap[group.id].last_message_time,
            sender_id: groupMessagesMap[group.id].sender_id,
          }
        : null,
      unread: groupUnreadCountsMap[group.id] || 0,
      type: "group",
    }));
    // Combine user and group chats
    const allChats = [...userChatList, ...groupChatList];
    // Sort by last message time (most recent first), then by name
    allChats.sort((a, b) => {
      if (!a.lastMessage?.time && !b.lastMessage?.time) {
        // Both have no messages, sort by name (handle null names)
        const nameA = a.name || "";
        const nameB = b.name || "";
        return nameA.localeCompare(nameB);
      }
      if (!a.lastMessage?.time) return 1;
      if (!b.lastMessage?.time) return -1;
      return new Date(b.lastMessage.time) - new Date(a.lastMessage.time);
    });
    res.json(allChats);
  } catch (error) {
    console.error("Error fetching chat list:", error);
    res.status(500).json({ error: "Failed to fetch chat list" });
  }
});
// Student registration endpoint
app.post("/api/students", upload.single("photo"), async (req, res) => {
  console.log("BODY:", req.body);
  console.log("FILE:", req.file);
  try {
    const {
      studentId,
      regDate,
      fullName,
      sex,
      dob,
      pob,
      father,
      mother,
      class: className,
      dept: specialtyName,
      contact,
    } = req.body;
    // Validate required fields
    if (
      !studentId ||
      !regDate ||
      !fullName ||
      !sex ||
      !dob ||
      !pob ||
      !className ||
      !specialtyName ||
      !contact
    ) {
      return res
        .status(400)
        .json({ error: "All fields except photo are required." });
    }
    // Find class_id and specialty_id
    const classResult = await pool.query(
      "SELECT id FROM classes WHERE name = $1",
      [className]
    );
    const specialtyResult = await pool.query(
      "SELECT id FROM specialties WHERE name = $1",
      [specialtyName]
    );
    const class_id = classResult.rows[0] ? classResult.rows[0].id : null;
    const specialty_id = specialtyResult.rows[0]
      ? specialtyResult.rows[0].id
      : null;
    // Handle photo upload
    let photo_url = null;
    if (req.file) {
      try {
        const filename = `student_${Date.now()}_${req.file.originalname}`;
        // Upload to FTP instead of local storage
        photo_url = await ftpService.uploadBuffer(req.file.buffer, filename);
        console.log("Photo uploaded to FTP:", photo_url);
      } catch (error) {
        console.error("Failed to upload photo to FTP:", error);
        // Fallback to local storage if FTP fails
        const fs = require("fs");
        const path = require("path");
        const uploadsDir = path.join(__dirname, "uploads");
        if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir);
        const filename = `student_${Date.now()}_${req.file.originalname}`;
        const filepath = path.join(uploadsDir, filename);
        fs.writeFileSync(filepath, req.file.buffer);
        photo_url = `/uploads/${filename}`;
        console.log("Photo saved locally as fallback:", photo_url);
      }
    }
    // Insert student into DB
    const insertResult = await pool.query(
      `INSERT INTO students (student_id, registration_date, full_name, sex, date_of_birth, place_of_birth, father_name, mother_name, class_id, specialty_id, guardian_contact, photo_url)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *`,
      [
        studentId,
        regDate,
        fullName,
        sex,
        dob,
        pob,
        father,
        mother,
        class_id,
        specialty_id,
        contact,
        photo_url,
      ]
    );
    const student = insertResult.rows[0];
    res.status(201).json(student);
  } catch (error) {
    console.error("Error registering student:", error);
    res
      .status(500)
      .json({ error: "Failed to register student", details: error.message });
  }
});
// GET /api/students - List all students with class/specialty names
app.get("/api/students", async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT s.*, c.name AS class_name, sp.name AS specialty_name
      FROM students s
      LEFT JOIN classes c ON s.class_id = c.id
      LEFT JOIN specialties sp ON s.specialty_id = sp.id
      ORDER BY s.created_at DESC
    `);
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: "Failed to fetch students" });
  }
});
// Add Multer error handler at the end, before app.listen or module.exports
app.use(function (err, req, res, next) {
  if (err instanceof require("multer").MulterError) {
    return res.status(400).json({ error: err.message });
  }
  next(err);
});
// Permanently delete a student by id
app.delete("/api/students/:id", async (req, res) => {
  const { id } = req.params;
  try {
    const result = await pool.query(
      "DELETE FROM students WHERE id = $1 RETURNING *",
      [id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Student not found" });
    }
    res.json({ message: "Student deleted successfully" });
  } catch (error) {
    console.error("Error deleting student:", error);
    res.status(500).json({ error: "Failed to delete student" });
  }
});
const uploadMany = multer({ storage: storage });
// Helper to parse Excel serial date or string to yyyy-mm-dd
function parseExcelDate(excelDate) {
  if (!excelDate) return null;
  if (typeof excelDate === "number") {
    // Excel's epoch starts at 1900-01-01
    const excelEpoch = new Date(Date.UTC(1899, 11, 30));
    const d = new Date(excelEpoch.getTime() + excelDate * 86400000);
    return d.toISOString().slice(0, 10);
  }
  if (typeof excelDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(excelDate)) {
    return excelDate;
  }
  // Try to parse as date string
  const d = new Date(excelDate);
  if (!isNaN(d)) return d.toISOString().slice(0, 10);
  return null;
}
// Bulk student registration from Excel (Upload Many)
app.post(
  "/api/students/upload-many",
  uploadMany.single("file"),
  async (req, res) => {
    try {
      if (!req.file) {
        return res.status(400).json({ error: "No Excel file uploaded" });
      }
      const XLSX = require("xlsx");
      const workbook = XLSX.readFile(req.file.path);
      const sheetName = workbook.SheetNames[0];
      const worksheet = workbook.Sheets[sheetName];
      const data = XLSX.utils.sheet_to_json(worksheet, { header: 1 });
      // Remove header row
      const rows = data.slice(1);
      if (!rows.length) {
        return res.status(400).json({ error: "Excel file is empty" });
      }
      // Expected columns: Full Name, Sex, Date of Birth, Place of Birth, Father's Name, Mother's Name, Class, Department/Specialty, Contact
      const today = new Date().toISOString().slice(0, 10);
      let created = 0;
      for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        if (!row[0]) continue; // skip if no full name
        const [
          fullName,
          sex,
          dob,
          pob,
          father,
          mother,
          className,
          dept,
          contact,
        ] = row;
        // Find class_id and specialty_id
        const classResult = await pool.query(
          "SELECT id FROM classes WHERE name = $1",
          [className]
        );
        const specialtyResult = await pool.query(
          "SELECT id FROM specialties WHERE name = $1",
          [dept]
        );
        const class_id = classResult.rows[0] ? classResult.rows[0].id : null;
        const specialty_id = specialtyResult.rows[0]
          ? specialtyResult.rows[0].id
          : null;
        // Generate student ID
        const first = (fullName.split(" ")[0] || "").slice(0, 2).toUpperCase();
        const last = (fullName.split(" ").slice(-1)[0] || "")
          .slice(-2)
          .toUpperCase();
        const year = today.slice(2, 4);
        const seq = (i + 1).toString().padStart(3, "0");
        const studentId = `${year}-VOT-${first}${last}-${seq}`;
        await pool.query(
          `INSERT INTO students (student_id, registration_date, full_name, sex, date_of_birth, place_of_birth, father_name, mother_name, class_id, specialty_id, guardian_contact, photo_url)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
          [
            studentId,
            today,
            fullName,
            sex,
            parseExcelDate(dob),
            pob,
            father,
            mother,
            class_id,
            specialty_id,
            contact,
            null,
          ]
        );
        created++;
      }
      // Clean up the uploaded file
      const fs = require("fs");
      fs.unlinkSync(req.file.path);
      res.json({ message: `${created} students uploaded successfully` });
    } catch (error) {
      console.error("Error in upload-many:", error);
      res.status(500).json({
        error: "Error uploading students from Excel",
        details: error.message,
      });
    }
  }
);
// === MESSAGES ENDPOINTS ===
// Send a message
app.post("/api/messages", authenticateToken, async (req, res) => {
  const sender_id = req.user.id;
  const { receiver_id, content } = req.body;
  if (!receiver_id || !content) {
    return res
      .status(400)
      .json({ error: "receiver_id and content are required" });
  }
  try {
    const result = await pool.query(
      "INSERT INTO messages (sender_id, receiver_id, content) VALUES ($1, $2, $3) RETURNING *",
      [sender_id, receiver_id, content]
    );
    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error("Error sending message:", error);
    res.status(500).json({ error: "Failed to send message" });
  }
});
// Send a message with file attachment
app.post(
  "/api/messages/with-file",
  authenticateToken,
  upload.single("file"),
  async (req, res) => {
    const sender_id = req.user.id;
    const { receiver_id, content } = req.body;
    const file = req.file;
    if (!receiver_id || (!content && !file)) {
      return res
        .status(400)
        .json({ error: "receiver_id and either content or file are required" });
    }
    try {
      let fileUrl = null;
      let fileName = null;
      let fileType = null;
      if (file) {
        // Validate file type
        const allowedTypes = [
          "image/jpeg",
          "image/jpg",
          "image/png",
          "image/gif",
          "application/pdf",
        ];
        if (!allowedTypes.includes(file.mimetype)) {
          return res.status(400).json({
            error: "Only images (JPEG, PNG, GIF) and PDF files are allowed",
          });
        }
        // Validate file size (5MB limit)
        if (file.size > 5 * 1024 * 1024) {
          return res
            .status(400)
            .json({ error: "File size must be less than 5MB" });
        }
        // Generate unique filename
        const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
        const fileExtension = path.extname(file.originalname);
        fileName = `message_${uniqueSuffix}${fileExtension}`;
        // Upload file to FTP
        try {
          fileUrl = await ftpService.uploadBuffer(file.buffer, fileName);
          console.log("Message file uploaded to FTP:", fileUrl);
        } catch (error) {
          console.error("Failed to upload message file to FTP:", error);
          // Fallback to local storage
          const fs = require("fs");
          const uploadPath = path.join(__dirname, "uploads", fileName);
          fs.writeFileSync(uploadPath, file.buffer);
          fileUrl = `/uploads/${fileName}`;
        }
        fileType = file.mimetype;
      }
      const result = await pool.query(
        "INSERT INTO messages (sender_id, receiver_id, content, file_url, file_name, file_type) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *",
        [sender_id, receiver_id, content || "", fileUrl, fileName, fileType]
      );
      res.status(201).json(result.rows[0]);
    } catch (error) {
      console.error("Error sending message with file:", error);
      res.status(500).json({ error: "Failed to send message" });
    }
  }
);
// Get all messages between logged-in user and another user
app.get("/api/messages/:userId", authenticateToken, async (req, res) => {
  const user1 = req.user.id;
  const user2 = parseInt(req.params.userId);
  try {
    const result = await pool.query(
      `SELECT m.*,
               u1.username as sender_username, u1.name as sender_name,
               u2.username as receiver_username, u2.name as receiver_name
        FROM messages m
        JOIN users u1 ON m.sender_id = u1.id
        JOIN users u2 ON m.receiver_id = u2.id
        WHERE (m.sender_id = $1 AND m.receiver_id = $2)
           OR (m.sender_id = $2 AND m.receiver_id = $1)
        ORDER BY m.created_at ASC`,
      [user1, user2]
    );
    res.json(result.rows);
  } catch (error) {
    console.error("Error fetching messages:", error);
    res.status(500).json({ error: "Failed to fetch messages" });
  }
});
// Mark messages as read
app.post("/api/messages/:userId/read", authenticateToken, async (req, res) => {
  const user1 = req.user.id;
  const user2 = parseInt(req.params.userId);
  try {
    // Check if 'read' column exists, if not, skip this operation
    const columnCheck = await pool.query(`
      SELECT column_name
      FROM information_schema.columns
      WHERE table_name = 'messages' AND column_name = 'read'
    `);
    if (columnCheck.rows.length > 0) {
      await pool.query(
        "UPDATE messages SET read = TRUE WHERE sender_id = $1 AND receiver_id = $2 AND read = FALSE",
        [user2, user1]
      );
    }
    res.json({ success: true });
  } catch (error) {
    console.error("Error marking messages as read:", error);
    res.status(500).json({ error: "Failed to mark messages as read" });
  }
});
// === SUBJECTS ENDPOINTS ===
// Get all subjects
app.get("/api/subjects", authenticateToken, async (req, res) => {
  try {
    const result = await pool.query("SELECT * FROM subjects ORDER BY name");
    res.json(result.rows);
  } catch (error) {
    console.error("Error fetching subjects:", error);
    res.status(500).json({ error: "Failed to fetch subjects" });
  }
});
// Create a new subject
app.post("/api/subjects", authenticateToken, async (req, res) => {
  const { name, code, description, credits, department } = req.body;
  if (!name) {
    return res.status(400).json({ error: "Subject name is required" });
  }
  try {
    const result = await pool.query(
      "INSERT INTO subjects (name, code, description, credits, department) VALUES ($1, $2, $3, $4, $5) RETURNING *",
      [
        name,
        code || null,
        description || null,
        credits || 0,
        department || null,
      ]
    );
    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error("Error creating subject:", error);
    if (error.code === "23505") {
      // Unique violation
      res.status(400).json({ error: "Subject code already exists" });
    } else {
      res.status(500).json({ error: "Failed to create subject" });
    }
  }
});
// Update a subject
app.put("/api/subjects/:id", authenticateToken, async (req, res) => {
  const id = parseInt(req.params.id);
  const { name, code, description, credits, department } = req.body;
  if (!name) {
    return res.status(400).json({ error: "Subject name is required" });
  }
  try {
    const result = await pool.query(
      "UPDATE subjects SET name = $1, code = $2, description = $3, credits = $4, department = $5, updated_at = CURRENT_TIMESTAMP WHERE id = $6 RETURNING *",
      [
        name,
        code || null,
        description || null,
        credits || 0,
        department || null,
        id,
      ]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Subject not found" });
    }
    res.json(result.rows[0]);
  } catch (error) {
    console.error("Error updating subject:", error);
    if (error.code === "23505") {
      // Unique violation
      res.status(400).json({ error: "Subject code already exists" });
    } else {
      res.status(500).json({ error: "Failed to update subject" });
    }
  }
});
// Delete a subject
app.delete("/api/subjects/:id", authenticateToken, async (req, res) => {
  const id = parseInt(req.params.id);
  try {
    const result = await pool.query(
      "DELETE FROM subjects WHERE id = $1 RETURNING *",
      [id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Subject not found" });
    }
    res.json({ message: "Subject deleted successfully" });
  } catch (error) {
    console.error("Error deleting subject:", error);
    res.status(500).json({ error: "Failed to delete subject" });
  }
});
// === SUBJECT CLASSIFICATION AND COEFFICIENT MANAGEMENT ===
// Get subject classifications for all classes
app.get("/api/subject-classifications", authenticateToken, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        class_id,
        subject_id,
        classification_type,
        created_at,
        updated_at
      FROM subject_classifications
      ORDER BY class_id, subject_id
    `);
    // Group by class_id for easier frontend consumption
    const classifications = {};
    result.rows.forEach((row) => {
      if (!classifications[row.class_id]) {
        classifications[row.class_id] = {};
      }
      classifications[row.class_id][row.subject_id] = row.classification_type;
    });
    res.json(classifications);
  } catch (error) {
    console.error("Error fetching subject classifications:", error);
    res.status(500).json({ error: "Failed to fetch subject classifications" });
  }
});
// Save subject classifications for a class
app.post(
  "/api/subject-classifications",
  authenticateToken,
  async (req, res) => {
    const { classId, classifications } = req.body;
    if (!classId || !classifications) {
      return res
        .status(400)
        .json({ error: "Class ID and classifications are required" });
    }
    try {
      // Start a transaction
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        // Delete existing classifications for this class
        await client.query(
          "DELETE FROM subject_classifications WHERE class_id = $1",
          [classId]
        );
        // Insert new classifications
        for (const [subjectId, classificationType] of Object.entries(
          classifications
        )) {
          if (classificationType) {
            await client.query(
              "INSERT INTO subject_classifications (class_id, subject_id, classification_type) VALUES ($1, $2, $3)",
              [classId, subjectId, classificationType]
            );
          }
        }
        await client.query("COMMIT");
        res.json({ message: "Subject classifications saved successfully" });
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally {
        client.release();
      }
    } catch (error) {
      console.error("Error saving subject classifications:", error);
      res.status(500).json({ error: "Failed to save subject classifications" });
    }
  }
);
// Get subject coefficients for all classes
app.get("/api/subject-coefficients", authenticateToken, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT
        class_id,
        subject_id,
        coefficient,
        created_at,
        updated_at
      FROM subject_coefficients
      ORDER BY class_id, subject_id
    `);
    // Group by class_id for easier frontend consumption
    const coefficients = {};
    result.rows.forEach((row) => {
      if (!coefficients[row.class_id]) {
        coefficients[row.class_id] = {};
      }
      coefficients[row.class_id][row.subject_id] = row.coefficient;
    });
    res.json(coefficients);
  } catch (error) {
    console.error("Error fetching subject coefficients:", error);
    res.status(500).json({ error: "Failed to fetch subject coefficients" });
  }
});
// Save subject coefficients for a class
app.post("/api/subject-coefficients", authenticateToken, async (req, res) => {
  const { classId, coefficients } = req.body;
  if (!classId || !coefficients) {
    return res
      .status(400)
      .json({ error: "Class ID and coefficients are required" });
  }
  try {
    // Start a transaction
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      // Delete existing coefficients for this class
      await client.query(
        "DELETE FROM subject_coefficients WHERE class_id = $1",
        [classId]
      );
      // Insert new coefficients
      for (const [subjectId, coefficient] of Object.entries(coefficients)) {
        if (coefficient && coefficient > 0) {
          await client.query(
            "INSERT INTO subject_coefficients (class_id, subject_id, coefficient) VALUES ($1, $2, $3)",
            [classId, subjectId, coefficient]
          );
        }
      }
      await client.query("COMMIT");
      res.json({ message: "Subject coefficients saved successfully" });
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  } catch (error) {
    console.error("Error saving subject coefficients:", error);
    res.status(500).json({ error: "Failed to save subject coefficients" });
  }
});
// === INVENTORY ENDPOINTS ===
// Get inventory items with type filter
app.get("/api/inventory", authenticateToken, async (req, res) => {
  try {
    const { type } = req.query;
    let query = "SELECT * FROM inventory";
    let params = [];
    if (type) {
      query += " WHERE type = $1";
      params.push(type);
    }
    query += " ORDER BY created_at DESC";
    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (error) {
    console.error("Error fetching inventory:", error);
    res.status(500).json({ error: "Failed to fetch inventory" });
  }
});
// Register new inventory item
app.post("/api/inventory", authenticateToken, async (req, res) => {
  try {
    const {
      date,
      item_name,
      department,
      quantity,
      estimated_cost,
      type,
      depreciation_rate,
    } = req.body;
    if (
      !date ||
      !item_name ||
      !department ||
      !quantity ||
      !estimated_cost ||
      !type
    ) {
      return res.status(400).json({ error: "Missing required fields" });
    }
    const result = await pool.query(
      `INSERT INTO inventory (date, item_name, department, quantity, estimated_cost, type, depreciation_rate)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [
        date,
        item_name,
        department,
        quantity,
        estimated_cost,
        type,
        depreciation_rate || null,
      ]
    );
    res.status(201).json(result.rows[0]);
  } catch (error) {
    console.error("Error registering inventory item:", error);
    res.status(500).json({ error: "Failed to register inventory item" });
  }
});
// Update inventory item
app.put("/api/inventory/:id", authenticateToken, async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const {
      date,
      item_name,
      department,
      quantity,
      estimated_cost,
      type,
      depreciation_rate,
    } = req.body;
    const result = await pool.query(
      `UPDATE inventory SET
        date = $1, item_name = $2, department = $3, quantity = $4,
        estimated_cost = $5, type = $6, depreciation_rate = $7, updated_at = CURRENT_TIMESTAMP
       WHERE id = $8 RETURNING *`,
      [
        date,
        item_name,
        department,
        quantity,
        estimated_cost,
        type,
        depreciation_rate || null,
        id,
      ]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Inventory item not found" });
    }
    res.json(result.rows[0]);
  } catch (error) {
    console.error("Error updating inventory item:", error);
    res.status(500).json({ error: "Failed to update inventory item" });
  }
});
// Delete inventory item
app.delete("/api/inventory/:id", authenticateToken, async (req, res) => {
  try {
    const id = parseInt(req.params.id);
    const result = await pool.query(
      "DELETE FROM inventory WHERE id = $1 RETURNING *",
      [id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Inventory item not found" });
    }
    res.json({ message: "Inventory item deleted successfully" });
  } catch (error) {
    console.error("Error deleting inventory item:", error);
    res.status(500).json({ error: "Failed to delete inventory item" });
  }
});
// === DEPARTMENTS ENDPOINTS ===
// Get all departments
app.get("/api/departments", authenticateToken, async (req, res) => {
  try {
    // Get departments from specialties table (since that's where departments are stored)
    const result = await pool.query(
      "SELECT DISTINCT name as department FROM specialties ORDER BY name"
    );
    // Also include any departments from inventory table
    const inventoryDepartments = await pool.query(
      "SELECT DISTINCT department FROM inventory WHERE department IS NOT NULL ORDER BY department"
    );
    // Combine and deduplicate departments
    const allDepartments = new Set();
    result.rows.forEach((row) => allDepartments.add(row.department));
    inventoryDepartments.rows.forEach((row) =>
      allDepartments.add(row.department)
    );
    const departments = Array.from(allDepartments).sort();
    res.json(departments.map((dept) => ({ name: dept })));
  } catch (error) {
    console.error("Error fetching departments:", error);
    res.status(500).json({ error: "Failed to fetch departments" });
  }
});
// ===== TEACHER APPLICATION ENDPOINTS =====
// Submit teacher application
app.post(
  "/api/teacher-application",
  authenticateToken,
  upload.fields([
    { name: "certificate", maxCount: 1 },
    { name: "cv", maxCount: 1 },
    { name: "photo", maxCount: 1 },
  ]),
  async (req, res) => {
    try {
      console.log("Teacher application submission started");
      console.log("User ID:", req.user.id);
      console.log("Request body:", req.body);
      console.log(
        "Request files:",
        req.files ? Object.keys(req.files) : "No files"
      );
      const userId = req.user.id;
      const { full_name, sex, id_card, dob, pob, subjects, classes, contact } =
        req.body;
      // Validate required fields
      if (
        !full_name ||
        !sex ||
        !id_card ||
        !dob ||
        !pob ||
        !subjects ||
        !classes ||
        !contact
      ) {
        console.log("Missing required fields:", {
          full_name,
          sex,
          id_card,
          dob,
          pob,
          subjects,
          classes,
          contact,
        });
        return res.status(400).json({ error: "All fields are required" });
      }
      console.log("All required fields present");
      // Upload files to FTP and get URLs
      let certificate_url = null;
      let cv_url = null;
      let photo_url = null;
      if (req.files && req.files.certificate && req.files.certificate[0]) {
        console.log(
          "Processing certificate file:",
          req.files.certificate[0].originalname
        );
        try {
          const filename = `certificate_${Date.now()}_${
            req.files.certificate[0].originalname
          }`;
          certificate_url = await ftpService.uploadBuffer(
            req.files.certificate[0].buffer,
            filename
          );
          console.log("Certificate uploaded to FTP:", certificate_url);
        } catch (error) {
          console.error("Failed to upload certificate to FTP:", error);
          // Fallback to local storage
          const fs = require("fs");
          const path = require("path");
          const uploadsDir = path.join(__dirname, "uploads");
          if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir);
          const filename = `certificate_${Date.now()}_${
            req.files.certificate[0].originalname
          }`;
          const filepath = path.join(uploadsDir, filename);
          fs.writeFileSync(filepath, req.files.certificate[0].buffer);
          certificate_url = `/uploads/${filename}`;
          console.log("Certificate saved locally:", certificate_url);
        }
      }
      if (req.files && req.files.cv && req.files.cv[0]) {
        console.log("Processing CV file:", req.files.cv[0].originalname);
        try {
          const filename = `cv_${Date.now()}_${req.files.cv[0].originalname}`;
          cv_url = await ftpService.uploadBuffer(
            req.files.cv[0].buffer,
            filename
          );
          console.log("CV uploaded to FTP:", cv_url);
        } catch (error) {
          console.error("Failed to upload CV to FTP:", error);
          // Fallback to local storage
          const fs = require("fs");
          const path = require("path");
          const uploadsDir = path.join(__dirname, "uploads");
          if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir);
          const filename = `cv_${Date.now()}_${req.files.cv[0].originalname}`;
          const filepath = path.join(uploadsDir, filename);
          fs.writeFileSync(filepath, req.files.cv[0].buffer);
          cv_url = `/uploads/${filename}`;
          console.log("CV saved locally:", cv_url);
        }
      }
      if (req.files && req.files.photo && req.files.photo[0]) {
        console.log("Processing photo file:", req.files.photo[0].originalname);
        try {
          const filename = `photo_${Date.now()}_${
            req.files.photo[0].originalname
          }`;
          photo_url = await ftpService.uploadBuffer(
            req.files.photo[0].buffer,
            filename
          );
          console.log("Photo uploaded to FTP:", photo_url);
        } catch (error) {
          console.error("Failed to upload photo to FTP:", error);
          // Fallback to local storage
          const fs = require("fs");
          const path = require("path");
          const uploadsDir = path.join(__dirname, "uploads");
          if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir);
          const filename = `photo_${Date.now()}_${
            req.files.photo[0].originalname
          }`;
          const filepath = path.join(uploadsDir, filename);
          fs.writeFileSync(filepath, req.files.photo[0].buffer);
          photo_url = `/uploads/${filename}`;
          console.log("Photo saved locally:", photo_url);
        }
      }
      console.log("File processing completed");
      // Check if teacher application already exists for this user
      console.log("Checking for existing teacher application");
      const existingResult = await pool.query(
        "SELECT * FROM teachers WHERE user_id = $1",
        [userId]
      );
      if (existingResult.rows.length > 0) {
        console.log("Teacher application already exists for user:", userId);
        return res
          .status(400)
          .json({ error: "Teacher application already exists for this user" });
      }
      console.log("Creating new teacher application");
      // Create new teacher application
      const result = await pool.query(
        `INSERT INTO teachers (user_id, full_name, sex, id_card, dob, pob, subjects, classes, contact, certificate_url, cv_url, photo_url, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, 'pending') RETURNING *`,
        [
          userId,
          full_name,
          sex,
          id_card,
          dob,
          pob,
          subjects,
          classes,
          contact,
          certificate_url,
          cv_url,
          photo_url,
        ]
      );
      console.log(
        "Teacher application created successfully:",
        result.rows[0].id
      );
      res.status(201).json(result.rows[0]);
    } catch (error) {
      console.error("Error submitting teacher application:", error);
      console.error("Error stack:", error.stack);
      res.status(500).json({
        error: "Failed to submit teacher application: " + error.message,
      });
    }
  }
);
// Edit teacher application
app.put(
  "/api/teacher-application/:id",
  authenticateToken,
  upload.fields([
    { name: "certificate", maxCount: 1 },
    { name: "cv", maxCount: 1 },
    { name: "photo", maxCount: 1 },
  ]),
  async (req, res) => {
    try {
      const userId = req.user.id;
      const teacherId = parseInt(req.params.id);
      const { full_name, sex, id_card, dob, pob, subjects, classes, contact } =
        req.body;
      // Validate required fields
      if (
        !full_name ||
        !sex ||
        !id_card ||
        !dob ||
        !pob ||
        !subjects ||
        !classes ||
        !contact
      ) {
        return res.status(400).json({ error: "All fields are required" });
      }
      // Upload files to FTP and get URLs
      let certificate_url = undefined;
      let cv_url = undefined;
      let photo_url = undefined;
      if (req.files && req.files.certificate && req.files.certificate[0]) {
        try {
          const filename = `certificate_${Date.now()}_${
            req.files.certificate[0].originalname
          }`;
          certificate_url = await ftpService.uploadBuffer(
            req.files.certificate[0].buffer,
            filename
          );
          console.log("Certificate uploaded to FTP:", certificate_url);
        } catch (error) {
          console.error("Failed to upload certificate to FTP:", error);
          // Fallback to local storage
          const fs = require("fs");
          const path = require("path");
          const uploadsDir = path.join(__dirname, "uploads");
          if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir);
          const filename = `certificate_${Date.now()}_${
            req.files.certificate[0].originalname
          }`;
          const filepath = path.join(uploadsDir, filename);
          fs.writeFileSync(filepath, req.files.certificate[0].buffer);
          certificate_url = `/uploads/${filename}`;
        }
      }
      if (req.files && req.files.cv && req.files.cv[0]) {
        try {
          const filename = `cv_${Date.now()}_${req.files.cv[0].originalname}`;
          cv_url = await ftpService.uploadBuffer(
            req.files.cv[0].buffer,
            filename
          );
          console.log("CV uploaded to FTP:", cv_url);
        } catch (error) {
          console.error("Failed to upload CV to FTP:", error);
          // Fallback to local storage
          const fs = require("fs");
          const path = require("path");
          const uploadsDir = path.join(__dirname, "uploads");
          if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir);
          const filename = `cv_${Date.now()}_${req.files.cv[0].originalname}`;
          const filepath = path.join(uploadsDir, filename);
          fs.writeFileSync(filepath, req.files.cv[0].buffer);
          cv_url = `/uploads/${filename}`;
        }
      }
      if (req.files && req.files.photo && req.files.photo[0]) {
        try {
          const filename = `photo_${Date.now()}_${
            req.files.photo[0].originalname
          }`;
          photo_url = await ftpService.uploadBuffer(
            req.files.photo[0].buffer,
            filename
          );
          console.log("Photo uploaded to FTP:", photo_url);
        } catch (error) {
          console.error("Failed to upload photo to FTP:", error);
          // Fallback to local storage
          const fs = require("fs");
          const path = require("path");
          const uploadsDir = path.join(__dirname, "uploads");
          if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir);
          const filename = `photo_${Date.now()}_${
            req.files.photo[0].originalname
          }`;
          const filepath = path.join(uploadsDir, filename);
          fs.writeFileSync(filepath, req.files.photo[0].buffer);
          photo_url = `/uploads/${filename}`;
        }
      }
      // Verify the teacher application belongs to the user
      const existingResult = await pool.query(
        "SELECT * FROM teachers WHERE id = $1 AND user_id = $2",
        [teacherId, userId]
      );
      if (existingResult.rows.length === 0) {
        return res.status(404).json({ error: "Teacher application not found" });
      }
      // Build update query dynamically
      let updateFields = [
        "full_name = $1",
        "sex = $2",
        "id_card = $3",
        "dob = $4",
        "pob = $5",
        "subjects = $6",
        "classes = $7",
        "contact = $8",
      ];
      let updateValues = [
        full_name,
        sex,
        id_card,
        dob,
        pob,
        subjects,
        classes,
        contact,
      ];
      let paramIndex = 9;
      if (certificate_url !== undefined) {
        updateFields.push(`certificate_url = $${paramIndex}`);
        updateValues.push(certificate_url);
        paramIndex++;
      }
      if (cv_url !== undefined) {
        updateFields.push(`cv_url = $${paramIndex}`);
        updateValues.push(cv_url);
        paramIndex++;
      }
      if (photo_url !== undefined) {
        updateFields.push(`photo_url = $${paramIndex}`);
        updateValues.push(photo_url);
        paramIndex++;
      }
      updateValues.push(teacherId);
      const updateQuery = `UPDATE teachers SET ${updateFields.join(
        ", "
      )} WHERE id = $${paramIndex} RETURNING *`;
      const result = await pool.query(updateQuery, updateValues);
      res.json(result.rows[0]);
    } catch (error) {
      console.error("Error updating teacher application:", error);
      res.status(500).json({
        error: "Failed to update teacher application: " + error.message,
      });
    }
  }
);
// Delete teacher application
app.delete(
  "/api/teacher-application/:id",
  authenticateToken,
  async (req, res) => {
    try {
      const userId = req.user.id;
      const teacherId = parseInt(req.params.id);
      // Verify the teacher application belongs to the user
      const existingResult = await pool.query(
        "SELECT * FROM teachers WHERE id = $1 AND user_id = $2",
        [teacherId, userId]
      );
      if (existingResult.rows.length === 0) {
        return res.status(404).json({ error: "Teacher application not found" });
      }
      // Delete the teacher application
      await pool.query("DELETE FROM teachers WHERE id = $1 AND user_id = $2", [
        teacherId,
        userId,
      ]);
      res.json({ message: "Teacher application deleted successfully" });
    } catch (error) {
      console.error("Error deleting teacher application:", error);
      res.status(500).json({ error: "Failed to delete teacher application" });
    }
  }
);
// Get teacher application for current user
app.get("/api/teacher-application", authenticateToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const result = await pool.query(
      "SELECT * FROM teachers WHERE user_id = $1",
      [userId]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: "No teacher application found" });
    }
    res.json(result.rows[0]);
  } catch (error) {
    console.error("Error fetching teacher application:", error);
    res.status(500).json({ error: "Failed to fetch teacher application" });
  }
});
// ===== END TEACHER APPLICATION ENDPOINTS =====
// Error handling middleware for multer errors
app.use((error, req, res, next) => {
  if (error instanceof multer.MulterError) {
    if (error.code === "LIMIT_FILE_SIZE") {
      return res
        .status(400)
        .json({ error: "File too large. Maximum file size is 10MB." });
    }
    if (error.code === "LIMIT_FILE_COUNT") {
      return res
        .status(400)
        .json({ error: "Too many files. Maximum 3 files allowed." });
    }
    if (error.code === "LIMIT_UNEXPECTED_FILE") {
      return res.status(400).json({ error: "Unexpected file field." });
    }
    return res
      .status(400)
      .json({ error: "File upload error: " + error.message });
  }
  if (error.message && error.message.includes("File type")) {
    return res.status(400).json({ error: error.message });
  }
  next(error);
});
// Get departments for inventory
app.get("/api/departments", authenticateToken, async (req, res) => {
  try {
    const result = await pool.query(
      "SELECT DISTINCT department FROM inventory ORDER BY department"
    );
    res.json(result.rows.map((row) => row.department));
  } catch (error) {
    console.error("Error fetching departments:", error);
    res.status(500).json({ error: "Failed to fetch departments" });
  }
});
// Get students by class
app.get("/api/students/class/:classId", authenticateToken, async (req, res) => {
  try {
    const { classId } = req.params;
    console.log(`[DEBUG] Fetching students for class ID: ${classId}`);
    // Validate class exists
    const classResult = await pool.query(
      "SELECT * FROM classes WHERE id = $1",
      [classId]
    );
    if (classResult.rows.length === 0) {
      console.log(`[DEBUG] Class not found with ID: ${classId}`);
      return res.status(404).json({ error: "Class not found" });
    }
    console.log(`[DEBUG] Class found: ${classResult.rows[0].name}`);
    // Get students for the class
    const result = await pool.query(
      `
      SELECT
        id,
        full_name,
        student_id,
        class_id
      FROM students
      WHERE class_id = $1
      ORDER BY full_name
    `,
      [classId]
    );
    console.log(
      `[DEBUG] Found ${result.rows.length} students for class ${classId}`
    );
    res.json(result.rows);
  } catch (error) {
    console.error("Error fetching students by class:", error);
    res.status(500).json({
      error: "Failed to fetch students for class",
      details: error.message,
    });
  }
});
// Test endpoint to check students table
app.get("/api/students/test", authenticateToken, async (req, res) => {
  try {
    console.log("[DEBUG] Testing students table access");
    const result = await pool.query("SELECT COUNT(*) as count FROM students");
    console.log(`[DEBUG] Students table has ${result.rows[0].count} records`);
    res.json({
      message: "Students table accessible",
      count: result.rows[0].count,
    });
  } catch (error) {
    console.error("Error testing students table:", error);
    res
      .status(500)
      .json({ error: "Students table test failed", details: error.message });
  }
});
// === Lesson Plans API ===
// === Applications API ===
// Get all applications (for all admins)
app.get("/api/applications", authenticateToken, async (req, res) => {
  try {
    const authUser = req.user;
    // All admin roles can view all applications
    if (!["Admin1", "Admin2", "Admin3", "Admin4"].includes(authUser.role)) {
      return res.status(403).json({
        error: "Access denied. Only administrators can view all applications.",
      });
    }
    const result = await pool.query(`
      SELECT
        a.*,
        u.username as applicant_username,
        u.name as applicant_full_name,
        u.role as applicant_role
      FROM applications a
      JOIN users u ON a.applicant_id = u.id
      ORDER BY a.submitted_at DESC
    `);
    res.json(result.rows);
  } catch (error) {
    console.error("Error fetching applications:", error);
    res.status(500).json({ error: "Failed to fetch applications" });
  }
});
// Get user's own application
app.get(
  "/api/applications/user/:userId",
  authenticateToken,
  async (req, res) => {
    try {
      const { userId } = req.params;
      const authUser = req.user;
      // Users can only view their own application
      if (
        authUser.id !== parseInt(userId) &&
        authUser.role !== "Admin1" &&
        authUser.role !== "Admin4"
      ) {
        return res.status(403).json({ error: "Access denied" });
      }
      const result = await pool.query(
        `
      SELECT * FROM applications
      WHERE applicant_id = $1
    `,
        [userId]
      );
      if (result.rows.length === 0) {
        return res.status(404).json({ error: "Application not found" });
      }
      res.json(result.rows[0]);
    } catch (error) {
      console.error("Error fetching user application:", error);
      res.status(500).json({ error: "Failed to fetch application" });
    }
  }
);
// Get user assigned data (classes and subjects)
app.get(
  "/api/user/assigned-data/:userId",
  authenticateToken,
  async (req, res) => {
    try {
      const { userId } = req.params;
      const authUser = req.user;
      // Users can only view their own assigned data or Admin1/Admin4 can view any user's data
      if (
        authUser.id !== parseInt(userId) &&
        authUser.role !== "Admin1" &&
        authUser.role !== "Admin4"
      ) {
        return res.status(403).json({ error: "Access denied" });
      }
      // Get user's application to see assigned classes and subjects
      const applicationResult = await pool.query(
        `
      SELECT classes, subjects FROM applications
      WHERE applicant_id = $1 AND status = 'approved'
    `,
        [userId]
      );
      let assignedClasses = [];
      let assignedSubjects = [];
      if (applicationResult.rows.length > 0) {
        const application = applicationResult.rows[0];
        // Parse assigned classes
        if (application.classes) {
          assignedClasses = application.classes
            .split(",")
            .map((c) => c.trim())
            .filter((c) => c);
        }
        // Parse assigned subjects
        if (application.subjects) {
          assignedSubjects = application.subjects
            .split(",")
            .map((s) => s.trim())
            .filter((s) => s);
        }
      }
      res.json({
        assignedClasses,
        assignedSubjects,
      });
    } catch (error) {
      console.error("Error fetching user assigned data:", error);
      res.status(500).json({ error: "Failed to fetch assigned data" });
    }
  }
);
// Submit new application
app.post(
  "/api/applications",
  authenticateToken,
  upload.single("certificate"),
  async (req, res) => {
    try {
      const authUser = req.user;
      console.log(
        "[DEBUG] Application submission - User:",
        authUser.username,
        "Role:",
        authUser.role
      );
      console.log("[DEBUG] Request body:", req.body);
      console.log(
        "[DEBUG] File:",
        req.file ? req.file.originalname : "No file"
      );
      // Check if user already has an application
      const existingApp = await pool.query(
        `
      SELECT id FROM applications WHERE applicant_id = $1
    `,
        [authUser.id]
      );
      if (existingApp.rows.length > 0) {
        return res
          .status(400)
          .json({ error: "You have already submitted an application" });
      }
      const { applicant_name, classes, subjects, contact } = req.body;
      console.log("[DEBUG] Extracted data:", {
        applicant_name,
        classes,
        subjects,
        contact,
      });
      // Validate required fields
      if (!applicant_name || !subjects || !contact) {
        return res
          .status(400)
          .json({ error: "Name, subjects, and contact are required fields" });
      }
      // For non-Admin4 users, classes can be empty as they will be assigned by Admin4
      if (authUser.role === "Admin4" && !classes) {
        return res
          .status(400)
          .json({ error: "Classes must be selected for Admin4 users" });
      }
      let certificateUrl = null;
      let certificateName = null;
      // Handle file upload if provided
      if (req.file) {
        try {
          const ftpFileName = `${authUser.id}_${Date.now()}_${
            req.file.originalname
          }`;
          certificateUrl = await ftpService.uploadBuffer(
            req.file.buffer,
            ftpFileName
          );
          certificateName = req.file.originalname;
          console.log("[DEBUG] Certificate uploaded to FTP:", certificateUrl);
        } catch (ftpError) {
          console.error("FTP upload failed:", ftpError);
          return res
            .status(500)
            .json({ error: "Failed to upload certificate" });
        }
      }
      const result = await pool.query(
        `
      INSERT INTO applications (
        applicant_id, applicant_name, classes, subjects, contact,
        certificate_url, certificate_name, status
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, 'pending')
      RETURNING *
    `,
        [
          authUser.id,
          applicant_name,
          classes,
          subjects,
          contact,
          certificateUrl,
          certificateName,
        ]
      );
      res.status(201).json({
        message: "Application submitted successfully",
        application: result.rows[0],
      });
    } catch (error) {
      console.error("Error submitting application:", error);
      res.status(500).json({ error: "Failed to submit application" });
    }
  }
);
// Update application
app.put(
  "/api/applications/:id",
  authenticateToken,
  upload.single("certificate"),
  async (req, res) => {
    try {
      const { id } = req.params;
      const authUser = req.user;
      const { applicant_name, classes, subjects, contact } = req.body;
      // Get the application
      const appResult = await pool.query(
        `
      SELECT * FROM applications WHERE id = $1
    `,
        [id]
      );
      if (appResult.rows.length === 0) {
        return res.status(404).json({ error: "Application not found" });
      }
      const application = appResult.rows[0];
      // Check permissions
      const canEdit =
        authUser.role === "Admin1" ||
        authUser.role === "Admin4" ||
        (application.applicant_id === authUser.id &&
          application.status === "pending");
      if (!canEdit) {
        return res
          .status(403)
          .json({ error: "You cannot edit this application" });
      }
      // Validate required fields
      if (!applicant_name || !subjects || !contact) {
        return res
          .status(400)
          .json({ error: "Name, subjects, and contact are required fields" });
      }
      // For non-Admin4 users, classes can be empty as they will be assigned by Admin4
      if (authUser.role === "Admin4" && !classes) {
        return res
          .status(400)
          .json({ error: "Classes must be selected for Admin4 users" });
      }
      let certificateUrl = application.certificate_url;
      let certificateName = application.certificate_name;
      // Handle file upload if provided
      if (req.file) {
        try {
          const ftpFileName = `certificates/${
            application.applicant_id
          }_${Date.now()}_${req.file.originalname}`;
          certificateUrl = await ftpService.uploadBuffer(
            req.file.buffer,
            ftpFileName
          );
          certificateName = req.file.originalname;
          console.log(
            "[DEBUG] Updated certificate uploaded to FTP:",
            certificateUrl
          );
        } catch (ftpError) {
          console.error("FTP upload failed:", ftpError);
          return res
            .status(500)
            .json({ error: "Failed to upload certificate" });
        }
      }
      const result = await pool.query(
        `
      UPDATE applications
      SET applicant_name = $1, classes = $2, subjects = $3, contact = $4,
          certificate_url = $5, certificate_name = $6
      WHERE id = $7
      RETURNING *
    `,
        [
          applicant_name,
          classes,
          subjects,
          contact,
          certificateUrl,
          certificateName,
          id,
        ]
      );
      res.json({
        message: "Application updated successfully",
        application: result.rows[0],
      });
    } catch (error) {
      console.error("Error updating application:", error);
      res.status(500).json({ error: "Failed to update application" });
    }
  }
);
// Update application status (approve/reject)
app.put("/api/applications/:id/status", authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const { status } = req.body;
    const authUser = req.user;
    // Only Admin1 and Admin4 can update status
    if (authUser.role !== "Admin1" && authUser.role !== "Admin4") {
      return res.status(403).json({
        error:
          "Access denied. Only administrators can update application status.",
      });
    }
    // Validate status
    if (!["pending", "approved", "rejected"].includes(status)) {
      return res.status(400).json({ error: "Invalid status" });
    }
    const result = await pool.query(
      `
      UPDATE applications
      SET status = $1, reviewed_at = NOW(), reviewed_by = $2
      WHERE id = $3
      RETURNING *
    `,
      [status, authUser.id, id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Application not found" });
    }
    res.json({
      message: "Application status updated successfully",
      application: result.rows[0],
    });
  } catch (error) {
    console.error("Error updating application status:", error);
    res.status(500).json({ error: "Failed to update application status" });
  }
});
// Delete application
app.delete("/api/applications/:id", authenticateToken, async (req, res) => {
  try {
    const { id } = req.params;
    const authUser = req.user;
    // Get the application
    const appResult = await pool.query(
      `
      SELECT * FROM applications WHERE id = $1
    `,
      [id]
    );
    if (appResult.rows.length === 0) {
      return res.status(404).json({ error: "Application not found" });
    }
    const application = appResult.rows[0];
    // Check permissions
    const canDelete =
      authUser.role === "Admin1" ||
      authUser.role === "Admin4" ||
      (application.applicant_id === authUser.id &&
        application.status === "pending");
    if (!canDelete) {
      return res
        .status(403)
        .json({ error: "You cannot delete this application" });
    }
    await pool.query("DELETE FROM applications WHERE id = $1", [id]);
    res.json({ message: "Application deleted successfully" });
  } catch (error) {
    console.error("Error deleting application:", error);
    res.status(500).json({ error: "Failed to delete application" });
  }
});
// === End Applications API ===
