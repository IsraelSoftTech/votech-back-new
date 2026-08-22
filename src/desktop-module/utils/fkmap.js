"use strict";

/**
 * fkmap.js  (server)
 *
 * Single source of truth for every foreign key column in every sync table.
 * Used by:
 *   - dumpGenerator.js     — enriches rows with parent sync_ids during dump
 *   - delta.controller.js  — resolves FKs on incoming delta records
 *   - client fkMap.ts      — mirrored on the client for import remapping
 *
 * Structure:
 *   FK_MAP[childTable] = [
 *     { col: 'column_name', refTable: 'parent_table' },
 *     ...
 *   ]
 *
 * Rules:
 *   - `col`      — exact PostgreSQL column name (snake_case) on the child table
 *   - `refTable` — exact PostgreSQL table name of the parent
 *   - Includes all integer FK columns regardless of whether a formal
 *     REFERENCES constraint exists — Sequelize associations define many FKs
 *     at the model layer without DB-level constraints
 *   - Server-internal table FKs (change_logs, user_devices, sync_audit_log,
 *     device_unbind_requests, sync_sessions) are excluded — those tables
 *     are never synced to the client
 *   - Nullable FK columns are included — the remapper handles null gracefully
 *
 * Notes:
 *   - "specialties" is the departments table for this system (legacy naming)
 *   - "academicYears" (camelCase) is the current active academic year table
 *   - "academic_years" (snake_case) is the legacy table — both are synced
 *   - cnps_preferences PK is user_id (not id) — handled specially in importer
 *   - staff_attendance_records, staff_attendance_settings,
 *     staff_employment_status have no FK columns to other sync tables
 */

const FK_MAP = {
  // ── DEPTH 1 — depends only on root tables ─────────────────────────────────

  sequences: [
    { col: "academic_year_id", refTable: "academicYears" },
    { col: "term_id", refTable: "terms" },
  ],

  classes: [
    { col: "class_master_id", refTable: "users" },
    { col: "department_id", refTable: "specialties" },
  ],

  teachers: [{ col: "user_id", refTable: "users" }],

  applications: [
    { col: "applicant_id", refTable: "users" },
    { col: "reviewed_by", refTable: "users" },
  ],

  events: [{ col: "created_by", refTable: "users" }],

  groups: [{ col: "creator_id", refTable: "users" }],

  hods: [
    { col: "hod_user_id", refTable: "users" },
    { col: "subject_id", refTable: "subjects" },
  ],

  lesson_plans: [
    { col: "user_id", refTable: "users" },
    { col: "reviewed_by", refTable: "users" },
  ],

  lessons: [
    { col: "user_id", refTable: "users" },
    { col: "reviewed_by", refTable: "users" },
  ],

  vocational: [{ col: "user_id", refTable: "users" }],

  user_activities: [{ col: "user_id", refTable: "users" }],

  user_sessions: [{ col: "user_id", refTable: "users" }],

  messages: [
    { col: "sender_id", refTable: "users" },
    { col: "receiver_id", refTable: "users" },
  ],

  financial_transactions: [
    { col: "budget_head_id", refTable: "budget_heads" },
    { col: "created_by", refTable: "users" },
  ],

  asset_depreciation: [{ col: "inventory_id", refTable: "inventory" }],

  report_inventory: [{ col: "head_id", refTable: "report_inventory_heads" }],

  teacher_discipline_cases: [
    { col: "teacher_id", refTable: "users" },
    { col: "recorded_by", refTable: "users" },
    { col: "resolved_by", refTable: "users" },
    { col: "created_by", refTable: "users" },
  ],

  salaries: [
    { col: "user_id", refTable: "users" },
    { col: "applicant_id", refTable: "applications" },
  ],

  cnps_preferences: [
    // user_id is the PK here — included so client can build remap entry
    // dumpImporter handles this table specially (no integer id column)
    { col: "user_id", refTable: "users" },
  ],

  id_cards: [{ col: "student_id", refTable: "students" }],

  // ── DEPTH 2 — depends on depth 0/1 tables ─────────────────────────────────

  academic_bands: [
    { col: "academic_year_id", refTable: "academicYears" },
    { col: "class_id", refTable: "classes" },
  ],

  class_masters: [{ col: "class_id", refTable: "classes" }],

  specialty_classes: [
    { col: "specialty_id", refTable: "specialties" },
    { col: "class_id", refTable: "classes" },
  ],

  class_subjects: [
    { col: "class_id", refTable: "classes" },
    { col: "subject_id", refTable: "subjects" },
    { col: "department_id", refTable: "specialties" },
    { col: "teacher_id", refTable: "users" },
  ],

  subject_coefficients: [
    { col: "class_id", refTable: "classes" },
    { col: "subject_id", refTable: "subjects" },
  ],

  subject_classifications: [
    { col: "class_id", refTable: "classes" },
    { col: "subject_id", refTable: "subjects" },
  ],

  teacher_assignments: [
    { col: "class_id", refTable: "classes" },
    { col: "subject_id", refTable: "subjects" },
    { col: "teacher_id", refTable: "users" },
  ],

  timetables: [{ col: "class_id", refTable: "classes" }],

  cases: [
    { col: "class_id", refTable: "classes" },
    { col: "created_by", refTable: "users" },
    { col: "assigned_to", refTable: "users" },
  ],

  discipline_cases: [
    { col: "student_id", refTable: "students" },
    { col: "class_id", refTable: "classes" },
    { col: "recorded_by", refTable: "users" },
    { col: "resolved_by", refTable: "users" },
    { col: "teacher_id", refTable: "teachers" },
  ],

  marks: [
    { col: "student_id", refTable: "students" },
    { col: "class_id", refTable: "classes" },
    { col: "subject_id", refTable: "subjects" },
    { col: "sequence_id", refTable: "sequences" },
    { col: "term_id", refTable: "terms" },
    { col: "academic_year_id", refTable: "academicYears" },
    { col: "uploaded_by", refTable: "users" },
  ],

  fees: [
    { col: "student_id", refTable: "students" },
    { col: "class_id", refTable: "classes" },
  ],

  attendance_sessions: [
    { col: "class_id", refTable: "classes" },
    { col: "taken_by", refTable: "users" },
  ],

  hod_teachers: [
    { col: "hod_id", refTable: "hods" },
    { col: "teacher_id", refTable: "users" },
  ],

  group_participants: [
    { col: "group_id", refTable: "groups" },
    { col: "user_id", refTable: "users" },
  ],

  // ── DEPTH 3 — deepest dependency chain ────────────────────────────────────

  attendance_records: [
    { col: "session_id", refTable: "attendance_sessions" },
    { col: "student_id", refTable: "students" },
    { col: "teacher_id", refTable: "users" },
  ],

  case_sessions: [
    { col: "case_id", refTable: "cases" },
    { col: "created_by", refTable: "users" },
  ],

  case_reports: [
    { col: "case_id", refTable: "cases" },
    { col: "sent_by", refTable: "users" },
    { col: "sent_to", refTable: "users" },
  ],
};

/**
 * APPEND_ONLY_TABLES
 *
 * Tables with no updatedAt column — only created_at or joined_at.
 * Delta sync uses created_at > lastSyncAt for these.
 * No LWW conflict resolution. Client never pushes these.
 */
const APPEND_ONLY_TABLES = new Set([
  "user_activities", // only created_at
  "user_sessions", // only created_at
  "messages", // only created_at
  "group_participants", // only joined_at
  "hod_teachers", // only created_at
  "groups", // only created_at
  "specialty_classes", // no timestamp columns at all
]);

/**
 * SOFT_DELETE_TABLES
 *
 * Tables that use deletedAt for soft deletes.
 * During delta sync, rows with deletedAt set must be
 * deleted locally rather than upserted.
 */
const SOFT_DELETE_TABLES = new Set([
  "academicYears",
  "terms",
  "marks",
  "class_subjects",
  "subjects",
]);

/**
 * NO_REMAP_TABLES
 *
 * Tables with no FK columns that need remapping during import.
 * Root tables only — nothing that references another sync table.
 */
const NO_REMAP_TABLES = new Set([
  "academicYears",
  "academic_years",
  "terms",
  "departments",
  "budget_heads",
  "asset_categories",
  "timetable_configs",
  "property_equipment",
  "report_inventory_heads",
  "salary_descriptions",
  "salary_payslip_settings",
  "inventory",
  "staff_attendance_settings",
  "staff_attendance_records",
  "staff_employment_status",
  "users",
  "specialties",
  "subjects",
  "cnps_preferences", // PK is user_id, no integer id — handled specially
]);

module.exports = {
  FK_MAP,
  APPEND_ONLY_TABLES,
  SOFT_DELETE_TABLES,
  NO_REMAP_TABLES,
};
