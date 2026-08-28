"use strict";

/**
 * SYNC_ORDER
 *
 * The definitive ordered list of tables for both dump generation (server)
 * and dump import (client). Order is strictly by FK dependency depth —
 * every parent table appears before all tables that reference it.
 *
 * This list ONLY includes tables that are synced to the client.
 * Server-internal tables (SequelizeMeta, change_logs, sync_sessions,
 * user_devices, device_unbind_requests, sync_audit_log, system_mode,
 * db_swap_log, db_swap_logs, id_cards, AuditLog) are excluded.
 *
 * Depth 0 — root tables, no FK dependencies
 * Depth 1 — depend only on depth 0
 * Depth 2 — depend on depth 0 or 1
 * Depth 3 — deepest chain
 *
 * The server uses this to stream tables to the dump file in order.
 * The client uses this to import rows from the dump file in order,
 * ensuring the SyncIdRemap table is populated with parent records
 * before any child record needs to resolve its FK columns.
 *
 * IMPORTANT: Do not change this order without re-running the
 * dependency depth analysis in fkMap.js. A wrong order causes
 * FK remap misses during import — child records arrive before
 * their parent's localId is in SyncIdRemap.
 */

const SYNC_ORDER = [
  // ── DEPTH 0 — Root tables, no FK dependencies ─────────────────────────────
  // These have no FK columns referencing other sync tables.
  // They must arrive first so all downstream remaps can resolve.

  "academicYears", // Primary academic year table (Sequelize-managed)
  // FK target for: sequences, marks, academic_bands,
  //                terms, fees, students
  "academic_years", // Legacy/parallel academic year table (snake_case)
  // No FK children — included for completeness

  "terms", // FK target for: sequences, marks
  "departments", // No FK children in sync scope
  "budget_heads", // FK target for: financial_transactions
  "asset_categories", // FK target for: inventory (implied)
  "timetable_configs", // No FK children
  "property_equipment", // No FK children
  "report_inventory_heads", // FK target for: report_inventory
  "salary_descriptions", // No FK children
  "salary_payslip_settings", // No FK children
  "staff_attendance_settings", // No FK children
  "inventory", // FK target for: asset_depreciation

  // users and specialties/subjects are depth 0 — no FK columns themselves
  // but heavily referenced by depth 1+ tables
  "users", // FK target for almost everything
  "specialties", // FK target for: classes, class_subjects,
  //                specialty_classes
  "subjects", // FK target for: class_subjects, hods, marks,
  //                subject_coefficients,
  //                subject_classifications,
  //                teacher_assignments
  "students", // FK target for: marks, fees, attendance_records,
  //                discipline_cases
  // NOTE: students has no enforced FK constraints
  // pointing FROM it in the DB, making it depth 0
  // despite having logical dependencies. Kept here
  // so child tables can remap student_id correctly.

  // ── DEPTH 1 — Depend only on depth 0 tables ───────────────────────────────

  "sequences", // → academicYears, terms
  "classes", // → users (class_master_id), specialties
  "teachers", // → users
  "applications", // → users
  "events", // → users
  "groups", // → users (creator_id)
  "hods", // → users, subjects
  "lesson_plans", // → users
  "lessons", // → users
  "vocational", // → users
  "user_activities", // → users (append-only)
  "user_sessions", // → users (append-only)
  "messages", // → users (sender_id, receiver_id), groups
  // NOTE: group_id FK — groups must be above this
  "financial_transactions", // → budget_heads, users
  "asset_depreciation", // → inventory
  "report_inventory", // → report_inventory_heads
  "teacher_discipline_cases", // → users (teacher_id)
  "staff_attendance_records", // → users
  "staff_employment_status", // → users
  "cnps_preferences", // → users
  "salaries", // → users, applications

  // ── DEPTH 2 — Depend on depth 0 or 1 tables ───────────────────────────────

  "academic_bands", // → academicYears, classes
  "class_masters", // → classes, users
  "specialty_classes", // → specialties, classes
  "class_subjects", // → classes, subjects, specialties, users
  "subject_coefficients", // → classes, subjects
  "subject_classifications", // → classes, subjects
  "teacher_assignments", // → classes, subjects, users
  "timetables", // → classes
  "cases", // → classes, users
  "discipline_cases", // → classes, users, teachers
  "marks", // → students, classes, subjects, sequences,
  //   terms, academicYears, users
  "fees", // → students, classes, academicYears
  "attendance_sessions", // → classes, users
  "hod_teachers", // → hods, users
  "group_participants", // → groups, users (append-only)

  // ── DEPTH 3 — Deepest dependency chain ────────────────────────────────────

  "attendance_records", // → attendance_sessions, students, users
  "case_sessions", // → cases, users
  "case_reports", // → cases, users
];

/**
 * SYNC_ORDER_SET
 * Fast lookup set — used to check if a table is in sync scope.
 */
const SYNC_ORDER_SET = new Set(SYNC_ORDER);

/**
 * getSyncIndex(tableName)
 * Returns the position of a table in SYNC_ORDER.
 * Used by the dump generator to validate table ordering at runtime.
 * Returns -1 if the table is not in sync scope.
 */
function getSyncIndex(tableName) {
  return SYNC_ORDER.indexOf(tableName);
}

module.exports = {
  SYNC_ORDER,
  SYNC_ORDER_SET,
  getSyncIndex,
};
