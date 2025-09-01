const express = require("express");
const cors = require("cors");
const path = require("path");
require("dotenv").config();

// Routers
const authRouter = require("./routes/auth");
const usersRouter = require("./routes/users");
const classesRouter = require("./routes/classes");
const feesRouter = require("./routes/fees");
const specialtiesRouter = require("./routes/specialties");
const teachersCoreRouter = require("./routes/teachers");
const groupsRouter = require("./routes/groups");
const lessonsRouter = require("./routes/lessons");
const lessonPlansRouter = require("./routes/lessonPlans");
const salaryRouter = require("./routes/salary");
const timetablesRouter = require("./routes/timetables");
const createEventsRouter = require("./routes/events");
const casesRouter = require("./routes/cases");
const inventoryRouter = require("./routes/inventory");
const financialRouter = require("./routes/financial");
const assetCategoriesRouter = require("./routes/asset-categories");
const budgetHeadsRouter = require("./routes/budget-heads");
const messagesRouter = require("./routes/messages");
const studentsRouter = require("./routes/students");
const monitorRouter = require("./routes/monitor");
const vocationalRouter = require("./routes/vocational");

// Factory routers needing pool/authenticate
const createAttendanceRouter = require("./routes/attendance");
const createDisciplineCasesRouter = require("./routes/discipline_cases");
const { pool, authenticateToken } = require("./routes/utils");

// v1 academic/marks domain (existing src routes)
const accademicYearRouter = require("./src/routes/accademicYear.route");
const subjectRouter = require("./src/routes/subject.route");
const classSubjectRouter = require("./src/routes/classSubject.route");
const departmentClassesRouter = require("./src/routes/departmentClasses.route");
const teacherRouter = require("./src/routes/teachers.route");
const classRouter = require("./src/routes/class.route");
const academicBandRouter = require("./src/routes/academicBand.route");
const marksRouter = require("./src/routes/mark.route");
const studentRouterV1 = require("./src/routes/students.route");
const reportCardRouter = require("./src/routes/reportCard.route");
const contentRouter = require("./src/routes/content.route");
const globalErrorController = require("./src/controllers/error.controller");

const app = express();

// CORS
const corsOptions = {
  origin: function (origin, callback) {
    const allowedOrigins = [
      "https://votechs7academygroup.com",
      "https://votech-latest-front.onrender.com",
      "http://localhost:3000",
      "http://localhost:3004",
    ];
    if (!origin) return callback(null, true);
    if (allowedOrigins.indexOf(origin) !== -1) callback(null, true);
    else callback(new Error("Not allowed by CORS"));
  },
  methods: ["GET", "POST", "PUT", "DELETE", "OPTIONS", "PATCH"],
  allowedHeaders: [
    "Content-Type",
    "Authorization",
    "Accept",
    "Origin",
    "X-Requested-With",
  ],
  credentials: true,
};

// Middleware
app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.originalUrl}`);
  next();
});
app.use(cors(corsOptions));
app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));
app.options("*", cors(corsOptions));

// Static
app.use("/uploads", express.static("uploads"));
app.use("/public", express.static(path.join(__dirname, "public")));

// Health
app.get("/api/test", (req, res) => {
  res.json({ message: "Server is running" });
});

// Core routes
// Auth mounted at /api to preserve existing clients like /api/login
app.use("/api", authRouter);
app.use("/api/users", usersRouter);
app.use("/api/classes", classesRouter);
app.use("/api/teachers", teachersCoreRouter);
app.use("/api/fees", feesRouter);
app.use("/api/specialties", specialtiesRouter);
app.use("/api/messages", messagesRouter);
app.use("/api/groups", groupsRouter);
app.use("/api/lessons", lessonsRouter);
app.use("/api/lesson-plans", lessonPlansRouter);
app.use("/api/salary", salaryRouter);
app.use("/api/timetables", timetablesRouter);
app.use("/api/events", createEventsRouter(pool, authenticateToken));
app.use("/api/cases", casesRouter);
app.use("/api/inventory", inventoryRouter);
app.use("/api/financial", financialRouter);
app.use("/api/asset-categories", assetCategoriesRouter);
app.use("/api/budget-heads", budgetHeadsRouter);
app.use("/api/monitor", monitorRouter);
app.use("/api/vocational", vocationalRouter);
app.use("/api/students", studentsRouter);

// Factory routes (pool + auth)
app.use("/api/attendance", createAttendanceRouter(pool, authenticateToken));
app.use(
  "/api/discipline-cases",
  createDisciplineCasesRouter(pool, authenticateToken)
);

// v1 academic/marks domain
app.use("/api/v1/academic-years", accademicYearRouter);
app.use("/api/v1/subjects", subjectRouter);
app.use("/api/v1/class-subjects", classSubjectRouter);
app.use("/api/v1/department-classes", departmentClassesRouter);
app.use("/api/v1/teachers", teacherRouter);
app.use("/api/v1/classes", classRouter);
app.use("/api/v1/academic-bands", academicBandRouter);
app.use("/api/v1/marks", marksRouter);
app.use("/api/v1/students", studentRouterV1);
app.use("/api/v1/report-cards", reportCardRouter);
app.use("/api/v1/content", contentRouter);

// Startup message
console.log("✅ Server routes mounted successfully");
console.log("📡 API endpoints available at /api/*");
console.log("🎓 Academic endpoints available at /api/v1/*");

// Error handler
// 404 handler (any unmatched route)
app.use("*", (req, res, next) => {
  const err = new Error(`Can't find ${req.originalUrl} on this server!`);
  err.statusCode = 404;
  err.status = "fail";
  err.isOperational = true;
  next(err);
});

// Global error handler (last middleware)
app.use(globalErrorController);

module.exports = app;
