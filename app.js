const express = require("express");
const cors = require("cors");
const path = require("path");
require("dotenv").config();
const fs = require("fs");

const app = express();

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

const corsOptions = {
  origin: function (origin, callback) {
    if (process.env.NODE_ENV !== "production") {
      console.log("🔍 CORS Check - Origin:", origin);
    }

    if (!origin || origin === "null") {
      if (process.env.NODE_ENV !== "production") {
        console.log("✅ CORS: Allowing request with no origin");
      }
      return callback(null, true);
    }

    if (
      origin.startsWith("file://") ||
      origin.startsWith("app://") ||
      origin.startsWith("capacitor-electron://")
    ) {
      if (process.env.NODE_ENV !== "production") {
        console.log("✅ CORS: Allowing file/app protocol");
      }
      return callback(null, true);
    }

    if (allowedOrigins.includes(origin)) {
      if (process.env.NODE_ENV !== "production") {
        console.log("✅ CORS: Origin allowed:", origin);
      }
      return callback(null, true);
    }

    // Reject
    console.warn("❌ CORS: Origin rejected:", origin);
    callback(new Error(`CORS blocked: ${origin} not in allowed origins`));
  },
  credentials: true,
  methods: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
  allowedHeaders: [
    "Content-Type",
    "Authorization",
    "X-Requested-With",
    "Accept",
    "Origin",
    "sync-key",
  ],
  exposedHeaders: ["Content-Range", "X-Content-Range"],
  maxAge: 86400,
};

app.use(cors(corsOptions));

app.options("*", cors(corsOptions));

app.use(express.json({ limit: "10mb" }));
app.use(express.urlencoded({ extended: true, limit: "10mb" }));

if (process.env.NODE_ENV !== "production") {
  app.use((req, res, next) => {
    if (req.method !== "OPTIONS") {
      console.log(
        `[${new Date().toISOString()}] ${req.method} ${
          req.originalUrl
        } - Origin: ${req.headers.origin || "no-origin"}`
      );
    }
    next();
  });
}

const DEV_UPLOAD_DIR = path.join(__dirname, "local_uploads");
fs.mkdirSync(DEV_UPLOAD_DIR, { recursive: true });

app.use("/uploads", express.static(DEV_UPLOAD_DIR));
app.use("/uploads", express.static("uploads"));
app.use("/public", express.static(path.join(__dirname, "public")));

console.log("📁 Uploads served at /uploads from", DEV_UPLOAD_DIR);

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
const hodsRouter = require("./routes/hods");
// const teacherDisciplineRouter = require("./routes/teacher-discipline-cases");
const profileRouter = require("./routes/profile");

const createAttendanceRouter = require("./routes/attendance");
const createStaffAttendanceRouter = require("./routes/staff-attendance");
const createDisciplineCasesRouter = require("./routes/discipline_cases");
const { pool, authenticateToken } = require("./routes/utils");

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
const departmentRouter = require("./src/routes/department.route");
const { readOnlyGate } = require("./src/controllers/contextSwitch.controller");

app.get("/api/test", (req, res) => {
  res.json({
    message: "Server is running",
    timestamp: new Date().toISOString(),
    cors: "enabled",
  });
});

app.get("/api/health", (req, res) => {
  res.json({
    status: "ok",
    origin: req.headers.origin || "no-origin",
    allowedOrigins: allowedOrigins,
  });
});

if (process.env.NODE_ENV === "desktop") {
  console.log("📱 Desktop mode: Loading database swap routes...");
  const syncRouter = require("./src/routes/sync.rotoutes");
  app.use("/api/v1/sync", syncRouter);
} else {
  console.log("🌐 Production mode: Database swap routes disabled");
}
app.use("/api", authRouter);

app.use(readOnlyGate);

app.use("/api/users", usersRouter);
app.use("/api/profile", profileRouter);
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
app.use("/api/hods", hodsRouter);
app.use("/api/students", studentsRouter);
// app.use("/api/teacher-discipline-cases", teacherDisciplineRouter);

app.use("/api/attendance", createAttendanceRouter(pool, authenticateToken));
app.use(
  "/api/staff-attendance",
  createStaffAttendanceRouter(pool, authenticateToken)
);
app.use(
  "/api/discipline-cases",
  createDisciplineCasesRouter(pool, authenticateToken)
);

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
app.use("/api/v1/departments", departmentRouter);

console.log("✅ Server routes mounted successfully");
console.log("📡 API endpoints available at /api/*");
console.log("🎓 Academic endpoints available at /api/v1/*");
console.log("🌐 CORS enabled for:", allowedOrigins);

app.use("*", (req, res, next) => {
  const err = new Error(`Can't find ${req.originalUrl} on this server!`);
  err.statusCode = 404;
  err.status = "fail";
  err.isOperational = true;
  next(err);
});

app.use(globalErrorController);

module.exports = app;
