"use strict";

// ─────────────────────────────────────────────────────────────────────────────
// scopeConfig.js
//
// Single source of truth for what each role receives during sync.
// Every table in the system is listed here.
//
// Key decisions encoded here:
//   - IdCard        → PUBLIC. Everyone can view and print. Image URL points to
//                     CDN — image create/update requires online, but the record
//                     itself syncs normally via LWW.
//   - User          → PUBLIC for the record list. Admin3 gets passwords (their
//                     own machine). Everyone else gets password replaced with
//                     "__redacted__" server-side. This is handled in
//                     dumpGenerator.js / scopeResolver.js, not here.
//   - AuditLog      → Admin3 only. They need it locally to handle complaints
//                     without switching between desktop and web.
//   - Classes, Specialties, ClassMasters, SpecialtyClass,
//     Subjects, ClassSubjects, SubjectCoefficients,
//     SubjectClassifications, TeacherAssignments, Timetables
//                   → PUBLIC. Everyone needs these for dropdowns and context.
//                     Ownership filtering removed — data is not sensitive and
//                     not having it breaks too many UI flows.
//   - Students      → Admin1/2/3/4 get all. Di/Ps/Te get only students in
//                     their assigned classes (via class_subjects +
//                     teacher_assignments).
//   - Marks         → Admin1/3 get all. Others get only their class+subject
//                     intersection.
//   - Fees          → Admin only. Teachers never see fees.
//   - LessonPlans, Lessons, Vocational
//                   → PUBLIC (all roles). Non-admin ownership enforced at app
//                     layer for writes, but everyone can read.
//   - UserSessions, UserActivities
//                   → PUBLIC. Everyone gets the full table for audit context.
//   - AttendanceSessions, AttendanceRecords
//                   → PUBLIC. Everyone gets everything — filtering is too
//                     complex and the data is not sensitive.
//   - StaffAttendanceRecords, StaffAttendanceSettings, StaffEmploymentStatus
//                   → PUBLIC (COND resolved as: sync to all, app layer controls
//                     writes).
//   - Finance tables → Admin roles only. Never to Di/Ps/Te.
// ─────────────────────────────────────────────────────────────────────────────

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

// Admin1 and Admin3: full academic access, full admin powers
const FULL_ADMIN_ROLES = [ROLES.ADMIN1, ROLES.ADMIN3];

// All four admin roles: finance access, full student/class access
const ADMIN_ROLES = [ROLES.ADMIN1, ROLES.ADMIN2, ROLES.ADMIN3, ROLES.ADMIN4];

const STRATEGY = {
  PUBLIC: "PUBLIC", // All authenticated roles, all rows
  FULL_FOR_ROLES: "FULL_FOR_ROLES", // Specific roles only, all rows
  OWNED: "OWNED", // Row-level filtering per user
  NEVER: "NEVER", // Never synced to any client
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
  // ── Server-internal tables — never synced ──────────────────────────────────

  SequelizeMeta: {
    strategy: STRATEGY.NEVER,
    notes: "Sequelize migration tracking. Server internal.",
  },
  ChangeLog: {
    strategy: STRATEGY.NEVER,
    notes: "Server-side trigger log. Not synced.",
  },
  DbSwapLog: {
    strategy: STRATEGY.NEVER,
    notes: "DB swap log. Server internal.",
  },
  DbSwapLogs: {
    strategy: STRATEGY.NEVER,
    notes: "DB swap log (duplicate model). Server internal.",
  },
  SystemMode: {
    strategy: STRATEGY.NEVER,
    notes: "Server system mode flag. Not synced.",
  },
  SwapAudit: {
    strategy: STRATEGY.NEVER,
    notes: "DB swap audit trail. Server internal.",
  },
  UserDevice: {
    strategy: STRATEGY.NEVER,
    notes: "Device binding is server-managed. Client never receives this.",
  },
  SyncAuditLog: {
    strategy: STRATEGY.NEVER,
    notes: "Sync audit log. Server only — except Admin3 (see AuditLog below).",
  },
  DeviceUnbindRequest: {
    strategy: STRATEGY.NEVER,
    notes: "Admin device management. Server only.",
  },
  SyncSession: {
    strategy: STRATEGY.NEVER,
    notes: "Server sync session tracking. Not synced to clients.",
  },

  // ── AuditLog — Admin3 only ────────────────────────────────────────────────
  // Admin3 needs this locally to handle user complaints without switching
  // between desktop and web. No other role needs it.
  AuditLog: {
    strategy: STRATEGY.FULL_FOR_ROLES,
    model: "AuditLog",
    allowedRoles: [ROLES.ADMIN3],
    notes: "Admin3 only. Needed locally for complaint resolution.",
  },

  // ── Academic structure — PUBLIC ────────────────────────────────────────────

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

  // ── Reference / lookup — PUBLIC ────────────────────────────────────────────

  AssetCategory: {
    strategy: STRATEGY.PUBLIC,
    model: "AssetCategory",
    notes: "All roles need asset categories.",
  },
  BudgetHead: {
    strategy: STRATEGY.PUBLIC,
    model: "BudgetHead",
    notes: "All roles need budget head list for dropdowns.",
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

  // ── Classes and structure — PUBLIC ────────────────────────────────────────
  // Previously filtered by assignment. Now PUBLIC so every user has the full
  // class list for dropdowns, context, and navigation. Not sensitive data.

  Class: {
    strategy: STRATEGY.PUBLIC,
    model: "Class",
    notes: "All roles get all classes. Needed for dropdowns and context.",
  },
  ClassMaster: {
    strategy: STRATEGY.PUBLIC,
    model: "ClassMaster",
    notes: "All roles get all class masters. Needed for dropdowns.",
  },
  Specialty: {
    strategy: STRATEGY.PUBLIC,
    model: "Specialty",
    notes: "All roles get all specialties. Needed for dropdowns.",
  },
  SpecialtyClass: {
    strategy: STRATEGY.PUBLIC,
    model: "SpecialtyClass",
    notes: "All roles get all specialty-class mappings.",
  },

  // ── Subjects and assignments — PUBLIC ─────────────────────────────────────
  // Same reasoning as classes — everyone needs the full lists for dropdowns,
  // report cards, and timetables. Marks are still filtered separately.

  Subject: {
    strategy: STRATEGY.PUBLIC,
    model: "Subject",
    notes: "All roles get all subjects. Needed for dropdowns.",
  },
  ClassSubject: {
    strategy: STRATEGY.PUBLIC,
    model: "ClassSubject",
    notes: "All roles get all class-subject mappings.",
  },
  SubjectCoefficient: {
    strategy: STRATEGY.PUBLIC,
    model: "SubjectCoefficient",
    notes: "All roles get all coefficients. Needed for report cards.",
  },
  SubjectClassification: {
    strategy: STRATEGY.PUBLIC,
    model: "SubjectClassification",
    notes: "All roles get all classifications.",
  },
  TeacherAssignment: {
    strategy: STRATEGY.PUBLIC,
    model: "TeacherAssignment",
    notes: "All roles get all teacher assignments. Needed for context.",
  },
  Timetable: {
    strategy: STRATEGY.PUBLIC,
    model: "Timetable",
    notes: "All roles get all timetables.",
  },

  // ── Staff directory — PUBLIC ───────────────────────────────────────────────
  // Passwords handled specially:
  //   - Admin3 → receives actual password hash (manages user accounts)
  //   - Everyone else → password field set to "__redacted__" server-side
  // This logic lives in dumpGenerator.js and scopeResolver.js, not here.

  User: {
    strategy: STRATEGY.PUBLIC,
    model: "User",
    filterType: FILTER_TYPE.CUSTOM,
    customFilter: {
      adminWithPasswords: [ROLES.ADMIN3], // only Admin3 gets real passwords
      stripPasswordForOthers: true, // everyone else gets "__redacted__"
    },
    notes:
      "All roles get full user list. Admin3 gets password hashes. All others get __redacted__ in the password field.",
  },
  Teacher: {
    strategy: STRATEGY.PUBLIC,
    model: "Teacher",
    notes: "All roles need the teacher list.",
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

  // ── ID Cards — PUBLIC ─────────────────────────────────────────────────────
  // All roles can view and print ID cards. The card_number and issued_at are
  // stored locally. The actual card image lives on a CDN — creating or updating
  // the image requires an online connection, but the record syncs via LWW.

  IdCard: {
    strategy: STRATEGY.PUBLIC,
    model: "IdCard",
    notes:
      "All roles get ID card records for printing. Image URL is CDN-hosted — image create/update requires online. Record syncs via LWW.",
  },

  // ── Students — filtered ────────────────────────────────────────────────────
  // Admins get all students. Di/Ps/Te get only students in their classes.

  Student: {
    strategy: STRATEGY.OWNED,
    model: "Student",
    filterType: FILTER_TYPE.BY_CLASS_IDS,
    filterKey: "class_id",
    notes:
      "Admin1/2/3/4 get all students. Di/Ps/Te get students in their assigned classes only.",
  },

  // ── Marks — filtered ──────────────────────────────────────────────────────
  // Admin1/3 get all. Others get only class+subject intersection.

  Mark: {
    strategy: STRATEGY.OWNED,
    model: "Mark",
    filterType: FILTER_TYPE.BY_CLASS_AND_SUBJECT,
    notes:
      "Admin1/3 get all. Others get marks for their assigned classes AND subjects only.",
  },

  // ── Attendance — PUBLIC ────────────────────────────────────────────────────
  // Not sensitive. Filtering via sessions join is error-prone. Sync everything.

  AttendanceSession: {
    strategy: STRATEGY.PUBLIC,
    model: "AttendanceSession",
    notes: "All roles get all attendance sessions.",
  },
  AttendanceRecord: {
    strategy: STRATEGY.PUBLIC,
    model: "AttendanceRecord",
    notes: "All roles get all attendance records.",
  },

  // ── Staff attendance — PUBLIC (COND resolved) ──────────────────────────────

  StaffAttendanceRecord: {
    strategy: STRATEGY.PUBLIC,
    model: "StaffAttendanceRecord",
    notes: "All roles. Write access enforced at app layer.",
  },
  StaffAttendanceSetting: {
    strategy: STRATEGY.PUBLIC,
    model: "StaffAttendanceSetting",
    notes: "All roles. Write access enforced at app layer.",
  },
  StaffEmploymentStatus: {
    strategy: STRATEGY.PUBLIC,
    model: "StaffEmploymentStatus",
    notes: "All roles. Write access enforced at app layer.",
  },

  // ── Discipline ─────────────────────────────────────────────────────────────

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
  DisciplineCase: {
    strategy: STRATEGY.OWNED,
    model: "DisciplineCase",
    filterType: FILTER_TYPE.CUSTOM,
    customFilter: {
      fullForRoles: [...ADMIN_ROLES, ROLES.DISCIPLINE, ROLES.PSYCHOSOCIAL],
      ownedByFields: ["recorded_by", "teacher_id"],
    },
    notes:
      "Admin/Discipline/Psychosocial get all. Teacher gets only cases where they are recorded_by or teacher_id.",
  },
  TeacherDisciplineCase: {
    strategy: STRATEGY.FULL_FOR_ROLES,
    model: "TeacherDisciplineCase",
    allowedRoles: [ROLES.ADMIN1, ROLES.DISCIPLINE],
    notes: "Admin1 and Discipline only.",
  },

  // ── Lesson plans & lessons — PUBLIC ───────────────────────────────────────
  // All roles sync. Write ownership enforced at app layer.

  LessonPlan: {
    strategy: STRATEGY.PUBLIC,
    model: "LessonPlan",
    notes: "All roles get all lesson plans. Write ownership at app layer.",
  },
  Lesson: {
    strategy: STRATEGY.PUBLIC,
    model: "Lesson",
    notes: "All roles get all lessons. Write ownership at app layer.",
  },

  // ── Vocational — PUBLIC ────────────────────────────────────────────────────

  Vocational: {
    strategy: STRATEGY.PUBLIC,
    model: "Vocational",
    notes: "All roles get all vocational records.",
  },

  // ── Messaging & groups — OWNED ────────────────────────────────────────────
  // Each user only syncs what they are part of. No admin override.

  Group: {
    strategy: STRATEGY.OWNED,
    model: "Group",
    filterType: FILTER_TYPE.BY_USER_ID_ONLY,
    notes: "Every role only gets groups they are a member of.",
  },
  GroupParticipant: {
    strategy: STRATEGY.OWNED,
    model: "GroupParticipant",
    filterType: FILTER_TYPE.BY_USER_ID_ONLY,
    notes: "Every role only gets participants of their own groups.",
  },
  Message: {
    strategy: STRATEGY.OWNED,
    model: "Message",
    filterType: FILTER_TYPE.BY_USER_ID_ONLY,
    notes: "Every role only gets their own messages.",
  },

  // ── User activity & sessions — PUBLIC ─────────────────────────────────────

  UserActivity: {
    strategy: STRATEGY.PUBLIC,
    model: "UserActivity",
    notes: "All roles get full activity log.",
  },
  UserSession: {
    strategy: STRATEGY.PUBLIC,
    model: "UserSession",
    notes: "All roles get full session log.",
  },

  // ── Inventory & assets ─────────────────────────────────────────────────────
  // PropertyEquipment, ReportInventory, ReportInventoryHead → PUBLIC (read).
  // Inventory, AssetDepreciation → Admin only (COND resolved as: admin only).

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
  Inventory: {
    strategy: STRATEGY.FULL_FOR_ROLES,
    model: "Inventory",
    allowedRoles: ADMIN_ROLES,
    notes: "Admin only.",
  },
  AssetDepreciation: {
    strategy: STRATEGY.FULL_FOR_ROLES,
    model: "AssetDepreciation",
    allowedRoles: ADMIN_ROLES,
    notes: "Admin only.",
  },

  // ── Applications (HR) ─────────────────────────────────────────────────────

  Application: {
    strategy: STRATEGY.FULL_FOR_ROLES,
    model: "Application",
    allowedRoles: ADMIN_ROLES,
    notes: "Admin only.",
  },

  // ── Finance — Admin only ───────────────────────────────────────────────────
  // COND resolved as: never to Di/Ps/Te. Finance data is sensitive.

  FinancialTransaction: {
    strategy: STRATEGY.FULL_FOR_ROLES,
    model: "FinancialTransaction",
    allowedRoles: ADMIN_ROLES,
    notes: "Admin only. Never sent to Di/Ps/Te.",
  },
  Salary: {
    strategy: STRATEGY.FULL_FOR_ROLES,
    model: "Salary",
    allowedRoles: ADMIN_ROLES,
    notes: "🚨 Sensitive. Admin only. Never sent to Di/Ps/Te.",
  },
  SalaryDescription: {
    strategy: STRATEGY.FULL_FOR_ROLES,
    model: "SalaryDescription",
    allowedRoles: ADMIN_ROLES,
    notes: "🚨 Sensitive. Admin only.",
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

  // ── Fees — Admin only ─────────────────────────────────────────────────────
  // Teachers do not see fees. Period.

  Fee: {
    strategy: STRATEGY.FULL_FOR_ROLES,
    model: "Fee",
    allowedRoles: ADMIN_ROLES,
    notes: "Admin only. Teachers never see fees.",
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
