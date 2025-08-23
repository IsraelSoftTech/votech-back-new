process.on("uncaughtException", (err) => {
  console.error("Uncaught Exception:", err);
});

process.on("unhandledRejection", (reason, promise) => {
  console.error("Unhandled Rejection:", reason);
});

const express = require("express");
const cors = require("cors");
const path = require("path");
const { Sequelize } = require("sequelize");
require("dotenv").config();

// Import route modules
const authRoutes = require("./routes/auth");
const feesRoutes = require("./routes/fees");
const studentsRoutes = require("./routes/students");
const classesRoutes = require("./routes/classes");
const teachersRoutes = require("./routes/teachers");
const usersRoutes = require("./routes/users");
const messagesRoutes = require("./routes/messages");
const inventoryRoutes = require("./routes/inventory");

// Import existing route modules
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
const subjectsRouter = require("./routes/subjects");

// Import FTP service
const ftpService = require("./ftp-service");

const app = express();
const PORT = 5000;

// Database configuration
if (!process.env.DB_NAME || !process.env.DB_PASSWORD || !process.env.DB_USER_NAME) {
  throw new Error("Database environment variables not set.");
}

const sequelize = new Sequelize(
  process.env.DB_NAME,
  process.env.DB_USER_NAME,
  process.env.DB_PASSWORD,
  {
    host: "31.97.113.198",
    dialect: "postgres",
  }
);

// Test database connection
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

// Middleware
app.use(cors());
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Log every incoming request
app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.originalUrl}`);
  next();
});

// Serve static files
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Test endpoints
app.get("/api/test", (req, res) => {
  res.json({ message: "Server is running!" });
});

app.get("/api/lesson-plans/test", (req, res) => {
  res.json({ message: "Lesson plans endpoint is working!" });
});

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

// Existing route modules
app.use('/api/lesson-plans', lessonPlansRouter);
app.use('/api/lessons', lessonsRouter);
app.use('/api/groups', groupsRouter);
app.use('/api/salary', salaryRouter);
app.use('/api/timetables', timetablesRouter);
app.use('/api/cases', casesRouter);
app.use('/api/attendance', createAttendanceRouter);
app.use('/api/discipline-cases', createDisciplineCasesRouter);
app.use('/api/events', createEventsRouter);
app.use('/api/applications', applicationsRouter);
app.use('/api/subjects', subjectsRouter);

// Error handling middleware
app.use((err, req, res, next) => {
  console.error('Error:', err.stack);
  res.status(500).json({ 
    error: 'Something went wrong!',
    message: err.message 
  });
});

// 404 handler
app.use('*', (req, res) => {
  res.status(404).json({ error: 'Route not found' });
});

// Start server
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`📊 API Documentation: http://localhost:${PORT}/api/test`);
});

module.exports = app;

