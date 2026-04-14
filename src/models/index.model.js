const { sequelize, DataTypes } = require("../db");

// ── Existing model files ─────────────────────────────────────────────────
const Subject = require("./Subject.model")(sequelize, DataTypes);
const ClassSubject = require("./ClassSubject.model")(sequelize, DataTypes);
const Class = require("./classes")(sequelize, DataTypes);
const Teacher = require("./teachers")(sequelize, DataTypes);
const marks = require("./Mark.model")(sequelize, DataTypes);
const users = require("./users")(sequelize, DataTypes);
const students = require("./students")(sequelize, DataTypes);
const AcademicYear = require("./AcademicYear.model")(sequelize, DataTypes);
const Term = require("./Term.model")(sequelize, DataTypes);
const Sequence = require("./Sequence.model")(sequelize, DataTypes);
const ReportCardComment = require("./ReportCard.model")(sequelize, DataTypes);
const ReportCardSnapshot = require("./ReportCardSnapShot.model")(
  sequelize,
  DataTypes
);
const specialties = require("./specialties")(sequelize, DataTypes);
const specialty_classes = require("./specialty_classes")(sequelize, DataTypes);
const academic_bands = require("./AcademicBand.model")(sequelize, DataTypes);
const change_logs = require("./changeLog.model")(sequelize, DataTypes);
const system_mode = require("./SystemMode.model")(sequelize, DataTypes);
const db_swap_logs = require("./dbSwapLog.model")(sequelize, DataTypes);
const swap_audit = require("./SwapAudit.model")(sequelize, DataTypes);
const UserDevice = require("./UserDevice.model")(sequelize, DataTypes);
const SyncSession = require("./syncSession.model")(sequelize, DataTypes);

// ── Inline models (no model file exists) ─────────────────────────────────
// These are tables created by other devs without Sequelize model files.
// We define minimal models here so the sync system can query them.

const Department = sequelize.define(
  "Department",
  {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    name: { type: DataTypes.STRING },
  },
  {
    tableName: "departments",
    timestamps: true,
    underscored: true,
  }
);

const BudgetHead = sequelize.define(
  "BudgetHead",
  {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    name: { type: DataTypes.STRING },
  },
  {
    tableName: "budget_heads",
    timestamps: true,
    underscored: true,
  }
);

const AssetCategory = sequelize.define(
  "AssetCategory",
  {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    name: { type: DataTypes.STRING },
  },
  {
    tableName: "asset_categories",
    timestamps: true,
    underscored: true,
  }
);

const TimetableConfig = sequelize.define(
  "TimetableConfig",
  {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
  },
  {
    tableName: "timetable_configs",
    timestamps: true,
    underscored: true,
  }
);

const Event = sequelize.define(
  "Event",
  {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    title: { type: DataTypes.STRING },
    description: { type: DataTypes.TEXT },
    startDate: { type: DataTypes.DATE, field: "start_date" },
    endDate: { type: DataTypes.DATE, field: "end_date" },
  },
  {
    tableName: "events",
    timestamps: true,
    underscored: true,
  }
);

const Case = sequelize.define(
  "Case",
  {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    title: { type: DataTypes.STRING },
    status: { type: DataTypes.STRING },
  },
  {
    tableName: "cases",
    timestamps: true,
    underscored: true,
  }
);

const CaseSession = sequelize.define(
  "CaseSession",
  {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    caseId: { type: DataTypes.INTEGER, field: "case_id" },
  },
  {
    tableName: "case_sessions",
    timestamps: true,
    underscored: true,
  }
);

const CaseReport = sequelize.define(
  "CaseReport",
  {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    caseId: { type: DataTypes.INTEGER, field: "case_id" },
  },
  {
    tableName: "case_reports",
    timestamps: true,
    underscored: true,
  }
);

const PropertyEquipment = sequelize.define(
  "PropertyEquipment",
  {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    name: { type: DataTypes.STRING },
  },
  {
    tableName: "property_equipment",
    timestamps: true,
    underscored: true,
  }
);

const ReportInventory = sequelize.define(
  "ReportInventory",
  {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
  },
  {
    tableName: "report_inventory",
    timestamps: true,
    underscored: true,
  }
);

const ReportInventoryHead = sequelize.define(
  "ReportInventoryHead",
  {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
  },
  {
    tableName: "report_inventory_heads",
    timestamps: true,
    underscored: true,
  }
);

const Hod = sequelize.define(
  "Hod",
  {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
  },
  {
    tableName: "hods",
    timestamps: true,
    underscored: true,
  }
);

const HodTeacher = sequelize.define(
  "HodTeacher",
  {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    hodId: { type: DataTypes.INTEGER, field: "hod_id" },
    teacherId: { type: DataTypes.INTEGER, field: "teacher_id" },
  },
  {
    tableName: "hod_teachers",
    timestamps: true,
    underscored: true,
  }
);

const FinancialTransaction = sequelize.define(
  "FinancialTransaction",
  {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    amount: { type: DataTypes.DECIMAL(12, 2) },
    type: { type: DataTypes.STRING },
  },
  {
    tableName: "financial_transactions",
    timestamps: true,
    underscored: true,
  }
);

const Salary = sequelize.define(
  "Salary",
  {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    teacherId: { type: DataTypes.INTEGER, field: "teacher_id" },
    amount: { type: DataTypes.DECIMAL(12, 2) },
  },
  {
    tableName: "salaries",
    timestamps: true,
    underscored: true,
  }
);

const SalaryDescription = sequelize.define(
  "SalaryDescription",
  {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
  },
  {
    tableName: "salary_descriptions",
    timestamps: true,
    underscored: true,
  }
);

const SalaryPayslipSettings = sequelize.define(
  "SalaryPayslipSettings",
  {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
  },
  {
    tableName: "salary_payslip_settings",
    timestamps: true,
    underscored: true,
  }
);

const CnpsPreference = sequelize.define(
  "CnpsPreference",
  {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
  },
  {
    tableName: "cnps_preferences",
    timestamps: true,
    underscored: true,
  }
);

const Application = sequelize.define(
  "Application",
  {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    userId: { type: DataTypes.INTEGER, field: "user_id" },
    status: { type: DataTypes.STRING },
  },
  {
    tableName: "applications",
    timestamps: true,
    underscored: true,
  }
);

const TeacherDisciplineCase = sequelize.define(
  "TeacherDisciplineCase",
  {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
  },
  {
    tableName: "teacher_discipline_cases",
    timestamps: true,
    underscored: true,
  }
);

const Inventory = sequelize.define(
  "Inventory",
  {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    name: { type: DataTypes.STRING },
  },
  {
    tableName: "inventory",
    timestamps: true,
    underscored: true,
  }
);

const AssetDepreciation = sequelize.define(
  "AssetDepreciation",
  {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
  },
  {
    tableName: "asset_depreciation",
    timestamps: true,
    underscored: true,
  }
);

const StaffAttendanceRecord = sequelize.define(
  "StaffAttendanceRecord",
  {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    userId: { type: DataTypes.INTEGER, field: "user_id" },
  },
  {
    tableName: "staff_attendance_records",
    timestamps: true,
    underscored: true,
  }
);

const StaffAttendanceSetting = sequelize.define(
  "StaffAttendanceSetting",
  {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
  },
  {
    tableName: "staff_attendance_settings",
    timestamps: true,
    underscored: true,
  }
);

const StaffEmploymentStatus = sequelize.define(
  "StaffEmploymentStatus",
  {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    userId: { type: DataTypes.INTEGER, field: "user_id" },
  },
  {
    tableName: "staff_employment_status",
    timestamps: true,
    underscored: true,
  }
);

const ClassMaster = sequelize.define(
  "ClassMaster",
  {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    classId: { type: DataTypes.INTEGER, field: "class_id" },
    teacherId: { type: DataTypes.INTEGER, field: "teacher_id" },
  },
  {
    tableName: "class_masters",
    timestamps: true,
    underscored: true,
  }
);

const SubjectCoefficient = sequelize.define(
  "SubjectCoefficient",
  {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    classId: { type: DataTypes.INTEGER, field: "class_id" },
    subjectId: { type: DataTypes.INTEGER, field: "subject_id" },
    coefficient: { type: DataTypes.INTEGER },
  },
  {
    tableName: "subject_coefficients",
    timestamps: true,
    underscored: true,
  }
);

const SubjectClassification = sequelize.define(
  "SubjectClassification",
  {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    classId: { type: DataTypes.INTEGER, field: "class_id" },
    subjectId: { type: DataTypes.INTEGER, field: "subject_id" },
  },
  {
    tableName: "subject_classifications",
    timestamps: true,
    underscored: true,
  }
);

const TeacherAssignment = sequelize.define(
  "TeacherAssignment",
  {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    classId: { type: DataTypes.INTEGER, field: "class_id" },
    teacherId: { type: DataTypes.INTEGER, field: "teacher_id" },
  },
  {
    tableName: "teacher_assignments",
    timestamps: true,
    underscored: true,
  }
);

const Timetable = sequelize.define(
  "Timetable",
  {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    classId: { type: DataTypes.INTEGER, field: "class_id" },
  },
  {
    tableName: "timetables",
    timestamps: true,
    underscored: true,
  }
);

const AttendanceSession = sequelize.define(
  "AttendanceSession",
  {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    classId: { type: DataTypes.INTEGER, field: "class_id" },
  },
  {
    tableName: "attendance_sessions",
    timestamps: true,
    underscored: true,
  }
);

const AttendanceRecord = sequelize.define(
  "AttendanceRecord",
  {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    sessionId: { type: DataTypes.INTEGER, field: "session_id" },
    studentId: { type: DataTypes.INTEGER, field: "student_id" },
  },
  {
    tableName: "attendance_records",
    timestamps: true,
    underscored: true,
  }
);

const DisciplineCase = sequelize.define(
  "DisciplineCase",
  {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    studentId: { type: DataTypes.INTEGER, field: "student_id" },
    recordedBy: { type: DataTypes.INTEGER, field: "recorded_by" },
    teacherId: { type: DataTypes.INTEGER, field: "teacher_id" },
  },
  {
    tableName: "discipline_cases",
    timestamps: true,
    underscored: true,
  }
);

const Fee = sequelize.define(
  "Fee",
  {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    studentId: { type: DataTypes.INTEGER, field: "student_id" },
    amount: { type: DataTypes.DECIMAL(12, 2) },
  },
  {
    tableName: "fees",
    timestamps: true,
    underscored: true,
  }
);

const LessonPlan = sequelize.define(
  "LessonPlan",
  {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    userId: { type: DataTypes.INTEGER, field: "user_id" },
  },
  {
    tableName: "lesson_plans",
    timestamps: true,
    underscored: true,
  }
);

const Lesson = sequelize.define(
  "Lesson",
  {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    userId: { type: DataTypes.INTEGER, field: "user_id" },
  },
  {
    tableName: "lessons",
    timestamps: true,
    underscored: true,
  }
);

const Vocational = sequelize.define(
  "Vocational",
  {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    userId: { type: DataTypes.INTEGER, field: "user_id" },
  },
  {
    tableName: "vocational",
    timestamps: true,
    underscored: true,
  }
);

const UserActivity = sequelize.define(
  "UserActivity",
  {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    userId: { type: DataTypes.INTEGER, field: "user_id" },
  },
  {
    tableName: "user_activities",
    timestamps: true,
    underscored: true,
  }
);

const UserSession = sequelize.define(
  "UserSession",
  {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    userId: { type: DataTypes.INTEGER, field: "user_id" },
  },
  {
    tableName: "user_sessions",
    timestamps: true,
    underscored: true,
  }
);

const Group = sequelize.define(
  "Group",
  {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    name: { type: DataTypes.STRING },
  },
  {
    tableName: "groups",
    timestamps: true,
    underscored: true,
  }
);

const GroupParticipant = sequelize.define(
  "GroupParticipant",
  {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    groupId: { type: DataTypes.INTEGER, field: "group_id" },
    userId: { type: DataTypes.INTEGER, field: "user_id" },
    joinedAt: { type: DataTypes.DATE, field: "joined_at" },
  },
  {
    tableName: "group_participants",
    timestamps: false,
  }
);

const Message = sequelize.define(
  "Message",
  {
    id: { type: DataTypes.INTEGER, autoIncrement: true, primaryKey: true },
    senderId: { type: DataTypes.INTEGER, field: "sender_id" },
    receiverId: { type: DataTypes.INTEGER, field: "receiver_id" },
    groupId: { type: DataTypes.INTEGER, field: "group_id" },
    content: { type: DataTypes.TEXT },
  },
  {
    tableName: "messages",
    timestamps: true,
    underscored: true,
  }
);

// ── Associations for inline models ───────────────────────────────────────

// AttendanceRecord belongs to AttendanceSession (needed for join queries)
AttendanceRecord.belongsTo(AttendanceSession, {
  foreignKey: "sessionId",
  as: "session",
});
AttendanceSession.hasMany(AttendanceRecord, {
  foreignKey: "sessionId",
  as: "records",
});

// Fee <-> Student
Fee.belongsTo(students, { foreignKey: "studentId", as: "student" });
students.hasMany(Fee, { foreignKey: "studentId", as: "fees" });

// Group <-> GroupParticipant
Group.hasMany(GroupParticipant, {
  foreignKey: "groupId",
  as: "participants",
});
GroupParticipant.belongsTo(Group, {
  foreignKey: "groupId",
  as: "group",
});

const models = {
  // From existing model files
  Subject,
  Class,
  ClassSubject,
  Teacher,
  Mark: marks,
  User: users,
  Student: students,
  AcademicYear,
  Term,
  Sequence,
  ReportCardComment,
  ReportCardSnapshot,
  Specialty: specialties,
  SpecialtyClass: specialty_classes,
  AcademicBand: academic_bands,
  ChangeLog: change_logs,
  SystemMode: system_mode,
  DbSwapLog: db_swap_logs,
  SwapAudit: swap_audit,
  UserDevice,
  SyncSession,

  // Inline models — no model file
  Department,
  BudgetHead,
  AssetCategory,
  TimetableConfig,
  Event,
  Case,
  CaseSession,
  CaseReport,
  PropertyEquipment,
  ReportInventory,
  ReportInventoryHead,
  Hod,
  HodTeacher,
  FinancialTransaction,
  Salary,
  SalaryDescription,
  SalaryPayslipSettings,
  CnpsPreference,
  Application,
  TeacherDisciplineCase,
  Inventory,
  AssetDepreciation,
  StaffAttendanceRecord,
  StaffAttendanceSetting,
  StaffEmploymentStatus,
  ClassMaster,
  SubjectCoefficient,
  SubjectClassification,
  TeacherAssignment,
  Timetable,
  AttendanceSession,
  AttendanceRecord,
  DisciplineCase,
  Fee,
  LessonPlan,
  Lesson,
  Vocational,
  UserActivity,
  UserSession,
  Group,
  GroupParticipant,
  Message,
};

// Call associate on models that have it (from existing model files)
Object.values(models).forEach((model) => {
  if (typeof model.associate === "function") {
    model.associate(models);
  }
});

module.exports = models;
