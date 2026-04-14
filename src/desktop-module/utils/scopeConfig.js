"use strict";

const ROLES = {
  ADMIN1: "Admin1",
  ADMIN2: "Admin2",
  ADMIN3: "Admin3",
  ADMIN4: "Admin4",
  DISCIPLINE: "Discipline",
  PSYCHOSOCIAL: "Psychosocial",
  TEACHER: "Teacher",
};

const ALL_ROLES = Object.values(ROLES);
const FULL_ADMIN_ROLES = [ROLES.ADMIN1, ROLES.ADMIN3];

const ADMIN_ROLES = [ROLES.ADMIN1, ROLES.ADMIN2, ROLES.ADMIN3, ROLES.ADMIN4];

const STRATEGY = {
  PUBLIC: "PUBLIC",
  FULL_FOR_ROLES: "FULL_FOR_ROLES",
  OWNED: "OWNED",
  NEVER: "NEVER",
};

const FILTER_TYPE = {
  BY_CLASS_IDS: "BY_CLASS_IDS",
  BY_SUBJECT_IDS: "BY_SUBJECT_IDS",
  BY_CLASS_AND_SUBJECT: "BY_CLASS_AND_SUBJECT",
  BY_USER_ID: "BY_USER_ID",
  BY_USER_ID_ONLY: "BY_USER_ID_ONLY",
  BY_CLASS_IDS_VIA_SESSIONS: "BY_CLASS_IDS_VIA_SESSIONS",
  BY_CLASS_IDS_VIA_STUDENTS: "BY_CLASS_IDS_VIA_STUDENTS",
  CUSTOM: "CUSTOM",
};

const SCOPE_CONFIG = {
  SequelizeMeta: {
    strategy: STRATEGY.NEVER,
    notes: "Sequelize migration tracking. Server internal.",
  },
  ChangeLog: {
    strategy: STRATEGY.NEVER,
    notes: "Server-side audit log. Not synced.",
  },
  DbSwapLog: {
    strategy: STRATEGY.NEVER,
    notes: "DB swap operations log. Server internal.",
  },
  DbSwapLogs: {
    strategy: STRATEGY.NEVER,
    notes: "DB swap operations log (duplicate model). Server internal.",
  },
  SystemMode: {
    strategy: STRATEGY.NEVER,
    notes: "Server system mode flag. Not synced.",
  },
  SwapAudit: {
    strategy: STRATEGY.NEVER,
    notes: "DB swap audit trail. Server internal.",
  },
  IdCard: {
    strategy: STRATEGY.NEVER,
    notes: "No LWW columns. No writable sync needed.",
  },
  UserDevice: {
    strategy: STRATEGY.NEVER,
    notes:
      "Device binding is server-managed. Client never receives this table.",
  },
  AuditLog: {
    strategy: STRATEGY.NEVER,
    notes: "LWW conflict log lives on the server only.",
  },
  SyncAuditLog: {
    strategy: STRATEGY.NEVER,
    notes: "Sync audit log. Server only.",
  },
  DeviceUnbindRequest: {
    strategy: STRATEGY.NEVER,
    notes: "Admin device management. Server only.",
  },

  AcademicYear: {
    strategy: STRATEGY.PUBLIC,
    model: "AcademicYear",
    notes: "All roles need academic year context.",
  },
  AcademicBand: {
    strategy: STRATEGY.PUBLIC,
    model: "AcademicBand",
    notes: "All roles need band definitions.",
  },
  Term: {
    strategy: STRATEGY.PUBLIC,
    model: "Term",
    notes: "All roles need term context.",
  },
  Sequence: {
    strategy: STRATEGY.PUBLIC,
    model: "Sequence",
    notes: "All roles need sequence context.",
  },
  Department: {
    strategy: STRATEGY.PUBLIC,
    model: "Department",
    notes: "All roles need department list.",
  },
  BudgetHead: {
    strategy: STRATEGY.PUBLIC,
    model: "BudgetHead",
    notes: "All roles need budget head list for dropdowns.",
  },
  AssetCategory: {
    strategy: STRATEGY.PUBLIC,
    model: "AssetCategory",
    notes: "All roles need asset categories.",
  },
  TimetableConfig: {
    strategy: STRATEGY.PUBLIC,
    model: "TimetableConfig",
    notes: "All roles need timetable config.",
  },
  Event: {
    strategy: STRATEGY.PUBLIC,
    model: "Event",
    notes: "All roles see all events. Write access enforced at app layer.",
  },
  Case: {
    strategy: STRATEGY.PUBLIC,
    model: "Case",
    notes: "All roles receive all cases.",
  },
  CaseSession: {
    strategy: STRATEGY.PUBLIC,
    model: "CaseSession",
    notes: "All roles receive all case sessions.",
  },
  CaseReport: {
    strategy: STRATEGY.PUBLIC,
    model: "CaseReport",
    notes: "All roles receive all case reports.",
  },
  PropertyEquipment: {
    strategy: STRATEGY.PUBLIC,
    model: "PropertyEquipment",
    notes: "All roles receive. Write is admin-only at app layer.",
  },
  ReportInventory: {
    strategy: STRATEGY.PUBLIC,
    model: "ReportInventory",
    notes: "All roles receive. Write is admin-only at app layer.",
  },
  ReportInventoryHead: {
    strategy: STRATEGY.PUBLIC,
    model: "ReportInventoryHead",
    notes: "All roles receive. Write is admin-only at app layer.",
  },
  Hod: {
    strategy: STRATEGY.PUBLIC,
    model: "Hod",
    notes: "All roles need HOD list.",
  },
  HodTeacher: {
    strategy: STRATEGY.PUBLIC,
    model: "HodTeacher",
    notes: "All roles need HOD-teacher assignments.",
  },
  Teacher: {
    strategy: STRATEGY.PUBLIC,
    model: "Teacher",
    notes: "All roles need teacher list.",
  },

  FinancialTransaction: {
    strategy: STRATEGY.FULL_FOR_ROLES,
    model: "FinancialTransaction",
    allowedRoles: ADMIN_ROLES,
    notes: "Finance data. Never sent to non-admin roles.",
  },
  Salary: {
    strategy: STRATEGY.FULL_FOR_ROLES,
    model: "Salary",
    allowedRoles: ADMIN_ROLES,
    notes: "🚨 Sensitive. Never sent to non-admin roles.",
  },
  SalaryDescription: {
    strategy: STRATEGY.FULL_FOR_ROLES,
    model: "SalaryDescription",
    allowedRoles: ADMIN_ROLES,
    notes: "🚨 Sensitive. Never sent to non-admin roles.",
  },
  SalaryPayslipSettings: {
    strategy: STRATEGY.FULL_FOR_ROLES,
    model: "SalaryPayslipSettings",
    allowedRoles: ADMIN_ROLES,
    notes: "Finance config. Admin only.",
  },
  CnpsPreference: {
    strategy: STRATEGY.FULL_FOR_ROLES,
    model: "CnpsPreference",
    allowedRoles: ADMIN_ROLES,
    notes: "Finance config. Admin only.",
  },
  Application: {
    strategy: STRATEGY.FULL_FOR_ROLES,
    model: "Application",
    allowedRoles: ADMIN_ROLES,
    notes: "HR applications. Admin only.",
  },
  TeacherDisciplineCase: {
    strategy: STRATEGY.FULL_FOR_ROLES,
    model: "TeacherDisciplineCase",
    allowedRoles: [ROLES.ADMIN1, ROLES.DISCIPLINE],
    notes: "Admin1 and Discipline only. No other role receives this.",
  },
  Inventory: {
    strategy: STRATEGY.FULL_FOR_ROLES,
    model: "Inventory",
    allowedRoles: ADMIN_ROLES,
    notes: "Admin only until stakeholder confirms other roles need it.",
  },
  AssetDepreciation: {
    strategy: STRATEGY.FULL_FOR_ROLES,
    model: "AssetDepreciation",
    allowedRoles: ADMIN_ROLES,
    notes: "Admin only until stakeholder confirms other roles need it.",
  },
  StaffAttendanceRecord: {
    strategy: STRATEGY.FULL_FOR_ROLES,
    model: "StaffAttendanceRecord",
    allowedRoles: ALL_ROLES,
    notes:
      "⚠️ COND — all roles for now. Revisit after stakeholder confirmation.",
  },
  StaffAttendanceSetting: {
    strategy: STRATEGY.FULL_FOR_ROLES,
    model: "StaffAttendanceSetting",
    allowedRoles: ALL_ROLES,
    notes:
      "⚠️ COND — all roles for now. Revisit after stakeholder confirmation.",
  },
  StaffEmploymentStatus: {
    strategy: STRATEGY.FULL_FOR_ROLES,
    model: "StaffEmploymentStatus",
    allowedRoles: ALL_ROLES,
    notes:
      "⚠️ COND — all roles for now. Revisit after stakeholder confirmation.",
  },

  User: {
    strategy: STRATEGY.OWNED,
    model: "User",
    filterType: FILTER_TYPE.CUSTOM,
    customFilter: {
      fullForAdmins: true,
      stripColumns: ["password"],
    },
    notes:
      "All roles get full user list. Password column stripped server-side always.",
  },

  Class: {
    strategy: STRATEGY.OWNED,
    model: "Class",
    filterType: FILTER_TYPE.BY_CLASS_IDS,
    notes: "Admin1/3 get all. Others get assigned classes only.",
  },
  ClassMaster: {
    strategy: STRATEGY.OWNED,
    model: "ClassMaster",
    filterType: FILTER_TYPE.BY_CLASS_IDS,
    filterKey: "classId",
    notes: "Filtered to user's assigned classes.",
  },
  Specialty: {
    strategy: STRATEGY.OWNED,
    model: "Specialty",
    filterType: FILTER_TYPE.CUSTOM,
    customFilter: {
      joinThrough: "SpecialtyClass",
      joinKey: "specialtyId",
      filterKey: "classId",
      fullForAdmins: true,
    },
    notes: "Filtered via specialty_classes join. Full admins get all.",
  },
  SpecialtyClass: {
    strategy: STRATEGY.OWNED,
    model: "SpecialtyClass",
    filterType: FILTER_TYPE.BY_CLASS_IDS,
    filterKey: "classId",
    notes: "Filtered to user's assigned classes.",
  },
  Subject: {
    strategy: STRATEGY.OWNED,
    model: "Subject",
    filterType: FILTER_TYPE.BY_SUBJECT_IDS,
    notes: "Admin1/3 get all. Others get assigned subjects only.",
  },
  ClassSubject: {
    strategy: STRATEGY.OWNED,
    model: "ClassSubject",
    filterType: FILTER_TYPE.BY_CLASS_IDS,
    filterKey: "classId",
    notes: "Filtered to user's assigned classes.",
  },
  SubjectCoefficient: {
    strategy: STRATEGY.OWNED,
    model: "SubjectCoefficient",
    filterType: FILTER_TYPE.BY_CLASS_IDS,
    filterKey: "classId",
    notes: "Filtered to user's assigned classes.",
  },
  SubjectClassification: {
    strategy: STRATEGY.OWNED,
    model: "SubjectClassification",
    filterType: FILTER_TYPE.BY_CLASS_IDS,
    filterKey: "classId",
    notes: "Filtered to user's assigned classes.",
  },
  TeacherAssignment: {
    strategy: STRATEGY.OWNED,
    model: "TeacherAssignment",
    filterType: FILTER_TYPE.BY_CLASS_IDS,
    filterKey: "classId",
    notes: "Filtered to user's assigned classes.",
  },
  Timetable: {
    strategy: STRATEGY.OWNED,
    model: "Timetable",
    filterType: FILTER_TYPE.BY_CLASS_IDS,
    filterKey: "classId",
    notes: "Filtered to user's assigned classes.",
  },
  Student: {
    strategy: STRATEGY.OWNED,
    model: "Student",
    filterType: FILTER_TYPE.BY_CLASS_IDS,
    filterKey: "classId",
    notes:
      "Admin roles get all students. Others get students in their classes only.",
  },
  Mark: {
    strategy: STRATEGY.OWNED,
    model: "Mark",
    filterType: FILTER_TYPE.BY_CLASS_AND_SUBJECT,
    notes:
      "Admin1/3 get all. Others get marks for their classes AND subjects only.",
  },
  AttendanceSession: {
    strategy: STRATEGY.OWNED,
    model: "AttendanceSession",
    filterType: FILTER_TYPE.BY_CLASS_IDS,
    filterKey: "classId",
    notes: "Filtered to user's assigned classes.",
  },
  AttendanceRecord: {
    strategy: STRATEGY.OWNED,
    model: "AttendanceRecord",
    filterType: FILTER_TYPE.BY_CLASS_IDS_VIA_SESSIONS,
    notes: "No direct classId. Joined through attendance_sessions.",
  },
  DisciplineCase: {
    strategy: STRATEGY.OWNED,
    model: "DisciplineCase",
    filterType: FILTER_TYPE.CUSTOM,
    customFilter: {
      fullForRoles: [...ADMIN_ROLES, ROLES.DISCIPLINE, ROLES.PSYCHOSOCIAL],
      ownedByFields: ["recordedBy", "teacherId"],
    },
    notes:
      "Admin/Discipline/Psychosocial get all. Teacher gets own records only.",
  },
  Fee: {
    strategy: STRATEGY.OWNED,
    model: "Fee",
    filterType: FILTER_TYPE.BY_CLASS_IDS_VIA_STUDENTS,
    notes:
      "Admin gets all. Others get fees for students in their classes only.",
  },
  LessonPlan: {
    strategy: STRATEGY.OWNED,
    model: "LessonPlan",
    filterType: FILTER_TYPE.BY_USER_ID,
    filterKey: "userId",
    notes: "Admins get all. Others get own lesson plans only.",
  },
  Lesson: {
    strategy: STRATEGY.OWNED,
    model: "Lesson",
    filterType: FILTER_TYPE.BY_USER_ID,
    filterKey: "userId",
    notes: "Admins get all. Others get own lessons only.",
  },
  Vocational: {
    strategy: STRATEGY.OWNED,
    model: "Vocational",
    filterType: FILTER_TYPE.BY_USER_ID,
    filterKey: "userId",
    notes: "Admins get all. Others get own vocational entries only.",
  },
  UserActivity: {
    strategy: STRATEGY.OWNED,
    model: "UserActivity",
    filterType: FILTER_TYPE.BY_USER_ID,
    filterKey: "userId",
    notes: "Admins get all. Others get own activity only.",
  },
  UserSession: {
    strategy: STRATEGY.OWNED,
    model: "UserSession",
    filterType: FILTER_TYPE.BY_USER_ID,
    filterKey: "userId",
    notes: "Admins get all. Others get own sessions only.",
  },
  Group: {
    strategy: STRATEGY.OWNED,
    model: "Group",
    filterType: FILTER_TYPE.BY_USER_ID_ONLY,
    notes:
      "Every role only gets groups they are a member of. No admin override.",
  },
  GroupParticipant: {
    strategy: STRATEGY.OWNED,
    model: "GroupParticipant",
    filterType: FILTER_TYPE.BY_USER_ID_ONLY,
    notes:
      "Every role only gets participants of their own groups. No admin override.",
  },
  Message: {
    strategy: STRATEGY.OWNED,
    model: "Message",
    filterType: FILTER_TYPE.BY_USER_ID_ONLY,
    notes: "Every role only gets their own messages. No admin override.",
  },
};

module.exports = {
  ROLES,
  ALL_ROLES,
  ADMIN_ROLES,
  FULL_ADMIN_ROLES,
  STRATEGY,
  FILTER_TYPE,
  SCOPE_CONFIG,
};
