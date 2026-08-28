"use strict";

const { pool } = require("../../../routes/utils");
const models = require("../../models/index.model");
const { sequelize } = require("../../models/index");
const {
  SCOPE_CONFIG,
  STRATEGY,
  ROLES,
  ADMIN_ROLES,
  FULL_ADMIN_ROLES,
} = require("../utils/scopeConfig");
const {
  FK_MAP,
  APPEND_ONLY_TABLES,
  SOFT_DELETE_TABLES,
} = require("../utils/fkmap");
const { SYNC_ORDER } = require("../utils/syncOrder");

// ── Constants ─────────────────────────────────────────────────────────────────

const MAX_PUSH_RECORDS = 500;
const MAX_PULL_RECORDS_PER_TABLE = 500;

// ── Per-table timestamp column map ────────────────────────────────────────────
//
// Derived from the actual PostgreSQL schema. Each entry lists which timestamp
// columns exist on that table so applyRecord and buildPullWhere never try to
// set or query a column that doesn't exist.
//
// Format: tableName → { updatedAt: bool, updated_at: bool, pull_ts: string }
// pull_ts is the column used for "give me rows newer than X" in pull queries.

const TABLE_TS = {
  // table                   | updatedAt | updated_at | pull_ts
  academicYears: { updatedAt: true, updated_at: false, pull_ts: '"updatedAt"' },
  academic_years: {
    updatedAt: true,
    updated_at: false,
    pull_ts: '"updatedAt"',
  },
  terms: { updatedAt: true, updated_at: false, pull_ts: '"updatedAt"' },
  departments: { updatedAt: true, updated_at: false, pull_ts: '"updatedAt"' },
  budget_heads: { updatedAt: true, updated_at: true, pull_ts: '"updatedAt"' },
  asset_categories: {
    updatedAt: true,
    updated_at: false,
    pull_ts: '"updatedAt"',
  },
  timetable_configs: {
    updatedAt: true,
    updated_at: true,
    pull_ts: '"updatedAt"',
  },
  property_equipment: {
    updatedAt: true,
    updated_at: true,
    pull_ts: '"updatedAt"',
  },
  report_inventory_heads: {
    updatedAt: false,
    updated_at: true,
    pull_ts: "updated_at",
  },
  salary_descriptions: {
    updatedAt: false,
    updated_at: true,
    pull_ts: "updated_at",
  },
  salary_payslip_settings: {
    updatedAt: false,
    updated_at: true,
    pull_ts: "updated_at",
  },
  staff_attendance_settings: {
    updatedAt: false,
    updated_at: true,
    pull_ts: "updated_at",
  },
  inventory: { updatedAt: true, updated_at: true, pull_ts: '"updatedAt"' },
  users: { updatedAt: true, updated_at: false, pull_ts: '"updatedAt"' },
  specialties: { updatedAt: true, updated_at: false, pull_ts: '"updatedAt"' },
  subjects: { updatedAt: true, updated_at: true, pull_ts: '"updatedAt"' },
  students: { updatedAt: true, updated_at: false, pull_ts: '"updatedAt"' },
  sequences: { updatedAt: true, updated_at: false, pull_ts: '"updatedAt"' },
  classes: { updatedAt: true, updated_at: false, pull_ts: '"updatedAt"' },
  teachers: { updatedAt: true, updated_at: false, pull_ts: '"updatedAt"' },
  applications: { updatedAt: true, updated_at: true, pull_ts: '"updatedAt"' },
  events: { updatedAt: true, updated_at: true, pull_ts: '"updatedAt"' },
  groups: { updatedAt: false, updated_at: false, pull_ts: "created_at" },
  hods: { updatedAt: false, updated_at: true, pull_ts: "updated_at" },
  lesson_plans: { updatedAt: true, updated_at: true, pull_ts: '"updatedAt"' },
  lessons: { updatedAt: true, updated_at: true, pull_ts: '"updatedAt"' },
  vocational: { updatedAt: true, updated_at: true, pull_ts: '"updatedAt"' },
  user_activities: {
    updatedAt: false,
    updated_at: false,
    pull_ts: "created_at",
  },
  user_sessions: { updatedAt: false, updated_at: false, pull_ts: "created_at" },
  messages: { updatedAt: false, updated_at: false, pull_ts: "created_at" },
  financial_transactions: {
    updatedAt: true,
    updated_at: true,
    pull_ts: '"updatedAt"',
  },
  asset_depreciation: {
    updatedAt: true,
    updated_at: false,
    pull_ts: '"updatedAt"',
  },
  report_inventory: {
    updatedAt: true,
    updated_at: true,
    pull_ts: '"updatedAt"',
  },
  teacher_discipline_cases: {
    updatedAt: true,
    updated_at: true,
    pull_ts: '"updatedAt"',
  },
  staff_attendance_records: {
    updatedAt: false,
    updated_at: true,
    pull_ts: "updated_at",
  },
  staff_employment_status: {
    updatedAt: false,
    updated_at: true,
    pull_ts: "updated_at",
  },
  cnps_preferences: {
    updatedAt: true,
    updated_at: true,
    pull_ts: '"updatedAt"',
  },
  salaries: { updatedAt: true, updated_at: true, pull_ts: '"updatedAt"' },
  academic_bands: { updatedAt: true, updated_at: true, pull_ts: '"updatedAt"' },
  class_masters: { updatedAt: true, updated_at: false, pull_ts: '"updatedAt"' },
  specialty_classes: { updatedAt: false, updated_at: false, pull_ts: null },
  class_subjects: {
    updatedAt: true,
    updated_at: false,
    pull_ts: '"updatedAt"',
  },
  subject_coefficients: {
    updatedAt: false,
    updated_at: true,
    pull_ts: "updated_at",
  },
  subject_classifications: {
    updatedAt: false,
    updated_at: true,
    pull_ts: "updated_at",
  },
  teacher_assignments: {
    updatedAt: true,
    updated_at: true,
    pull_ts: '"updatedAt"',
  },
  timetables: { updatedAt: true, updated_at: true, pull_ts: '"updatedAt"' },
  cases: { updatedAt: true, updated_at: true, pull_ts: '"updatedAt"' },
  discipline_cases: {
    updatedAt: true,
    updated_at: false,
    pull_ts: '"updatedAt"',
  },
  marks: { updatedAt: true, updated_at: false, pull_ts: '"updatedAt"' },
  fees: { updatedAt: true, updated_at: false, pull_ts: '"updatedAt"' },
  attendance_sessions: {
    updatedAt: true,
    updated_at: false,
    pull_ts: '"updatedAt"',
  },
  hod_teachers: { updatedAt: false, updated_at: false, pull_ts: "created_at" },
  group_participants: {
    updatedAt: false,
    updated_at: false,
    pull_ts: "joined_at",
  },
  attendance_records: {
    updatedAt: true,
    updated_at: false,
    pull_ts: '"updatedAt"',
  },
  case_sessions: { updatedAt: true, updated_at: true, pull_ts: '"updatedAt"' },
  case_reports: { updatedAt: true, updated_at: false, pull_ts: '"updatedAt"' },
};

// ── Per-table column allowlist ────────────────────────────────────────────────
//
// Generated directly from the PostgreSQL schema (tables_and_data_types).
// sanitizeRecordForServer uses this to strip any field the client sends
// that doesn't actually exist as a column on the server — no more whack-a-mole.

const TABLE_COLUMNS = {
  academicYears: new Set([
    "id",
    "name",
    "start_date",
    "end_date",
    "status",
    "createdAt",
    "updatedAt",
    "deletedAt",
    "sync_id",
  ]),
  academic_years: new Set([
    "id",
    "year_name",
    "start_date",
    "end_date",
    "is_active",
    "created_at",
    "updatedAt",
    "updatedBy",
    "deviceId",
    "sync_id",
  ]),
  terms: new Set([
    "id",
    "name",
    "order_number",
    "academic_year_id",
    "createdAt",
    "updatedAt",
    "deletedAt",
    "updatedBy",
    "deviceId",
    "sync_id",
  ]),
  departments: new Set([
    "id",
    "name",
    "createdAt",
    "updatedAt",
    "updatedBy",
    "deviceId",
    "sync_id",
  ]),
  budget_heads: new Set([
    "id",
    "name",
    "code",
    "category",
    "description",
    "allocated_amount",
    "is_active",
    "created_at",
    "updated_at",
    "updatedAt",
    "updatedBy",
    "deviceId",
    "sync_id",
  ]),
  asset_categories: new Set([
    "id",
    "name",
    "description",
    "default_depreciation_rate",
    "useful_life_years",
    "is_active",
    "created_at",
    "updatedAt",
    "updatedBy",
    "deviceId",
    "sync_id",
  ]),
  timetable_configs: new Set([
    "id",
    "config",
    "created_at",
    "updated_at",
    "updatedAt",
    "updatedBy",
    "deviceId",
    "sync_id",
  ]),
  property_equipment: new Set([
    "id",
    "name",
    "cost",
    "department_location",
    "created_at",
    "updated_at",
    "updatedAt",
    "updatedBy",
    "deviceId",
    "sync_id",
  ]),
  report_inventory_heads: new Set([
    "id",
    "name",
    "created_at",
    "updated_at",
    "sync_id",
  ]),
  salary_descriptions: new Set([
    "id",
    "description",
    "percentage",
    "created_at",
    "updated_at",
    "sync_id",
  ]),
  salary_payslip_settings: new Set(["id", "settings", "updated_at", "sync_id"]),
  staff_attendance_settings: new Set([
    "id",
    "setting_key",
    "setting_value",
    "description",
    "created_at",
    "updated_at",
    "sync_id",
  ]),
  inventory: new Set([
    "id",
    "date",
    "item_name",
    "department",
    "quantity",
    "estimated_cost",
    "type",
    "depreciation_rate",
    "created_at",
    "updated_at",
    "budget_head_id",
    "asset_category",
    "purchase_date",
    "supplier",
    "warranty_expiry",
    "location",
    "condition",
    "updatedAt",
    "updatedBy",
    "deviceId",
    "sync_id",
  ]),
  users: new Set([
    "id",
    "username",
    "contact",
    "password",
    "name",
    "email",
    "gender",
    "role",
    "created_at",
    "suspended",
    "createdAt",
    "updatedAt",
    "profile_image_url",
    "updatedBy",
    "deviceId",
    "scopeVersion",
    "sync_id",
  ]),
  specialties: new Set([
    "id",
    "name",
    "abbreviation",
    "created_at",
    "createdAt",
    "updatedAt",
    "updatedBy",
    "deviceId",
    "sync_id",
  ]),
  subjects: new Set([
    "id",
    "name",
    "code",
    "created_at",
    "description",
    "credits",
    "department",
    "updated_at",
    "coefficient",
    "category",
    "createdAt",
    "updatedAt",
    "deletedAt",
    "updatedBy",
    "deviceId",
    "sync_id",
  ]),
  students: new Set([
    "id",
    "student_id",
    "registration_date",
    "full_name",
    "sex",
    "date_of_birth",
    "place_of_birth",
    "father_name",
    "mother_name",
    "class_id",
    "specialty_id",
    "guardian_contact",
    "mother_contact",
    "photo_url",
    "created_at",
    "photo",
    "academic_year_id",
    "createdAt",
    "updatedAt",
    "deletedAt",
    "sync_id",
  ]),
  sequences: new Set([
    "id",
    "name",
    "order_number",
    "academic_year_id",
    "createdAt",
    "updatedAt",
    "term_id",
    "deletedAt",
    "updatedBy",
    "deviceId",
    "sync_id",
  ]),
  classes: new Set([
    "id",
    "name",
    "registration_fee",
    "bus_fee",
    "internship_fee",
    "remedial_fee",
    "tuition_fee",
    "pta_fee",
    "total_fee",
    "suspended",
    "created_at",
    "createdAt",
    "updatedAt",
    "class_master_id",
    "department_id",
    "updatedBy",
    "deviceId",
    "sync_id",
  ]),
  teachers: new Set([
    "id",
    "full_name",
    "sex",
    "id_card",
    "dob",
    "pob",
    "subjects",
    "classes",
    "contact",
    "created_at",
    "status",
    "user_id",
    "certificate_url",
    "cv_url",
    "photo_url",
    "updatedAt",
    "updatedBy",
    "deviceId",
    "sync_id",
  ]),
  applications: new Set([
    "id",
    "applicant_id",
    "applicant_name",
    "classes",
    "subjects",
    "contact",
    "certificate_url",
    "certificate_name",
    "status",
    "admin_comment",
    "submitted_at",
    "reviewed_at",
    "reviewed_by",
    "experience_years",
    "education_level",
    "current_salary",
    "expected_salary",
    "availability",
    "additional_info",
    "created_at",
    "updated_at",
    "updatedAt",
    "updatedBy",
    "deviceId",
    "sync_id",
  ]),
  events: new Set([
    "id",
    "title",
    "description",
    "event_type",
    "event_date",
    "event_time",
    "participants",
    "created_by",
    "created_at",
    "updated_at",
    "updatedAt",
    "updatedBy",
    "deviceId",
    "sync_id",
  ]),
  groups: new Set(["id", "name", "creator_id", "created_at", "sync_id"]),
  hods: new Set([
    "id",
    "department_name",
    "hod_user_id",
    "subject_id",
    "suspended",
    "created_at",
    "updated_at",
    "sync_id",
  ]),
  lesson_plans: new Set([
    "id",
    "user_id",
    "title",
    "period_type",
    "file_url",
    "status",
    "admin_comment",
    "submitted_at",
    "reviewed_at",
    "reviewed_by",
    "subject",
    "class_name",
    "week",
    "objectives",
    "content",
    "activities",
    "assessment",
    "resources",
    "file_name",
    "updated_at",
    "updatedAt",
    "updatedBy",
    "deviceId",
    "sync_id",
  ]),
  lessons: new Set([
    "id",
    "user_id",
    "title",
    "subject",
    "class_name",
    "week",
    "period_type",
    "objectives",
    "content",
    "activities",
    "assessment",
    "resources",
    "status",
    "admin_comment",
    "created_at",
    "updated_at",
    "reviewed_at",
    "reviewed_by",
    "updatedAt",
    "updatedBy",
    "deviceId",
    "sync_id",
  ]),
  vocational: new Set([
    "id",
    "user_id",
    "name",
    "description",
    "picture1",
    "picture2",
    "picture3",
    "picture4",
    "year",
    "created_at",
    "updated_at",
    "updatedAt",
    "updatedBy",
    "deviceId",
    "sync_id",
  ]),
  user_activities: new Set([
    "id",
    "user_id",
    "activity_type",
    "activity_description",
    "entity_type",
    "entity_id",
    "entity_name",
    "ip_address",
    "user_agent",
    "created_at",
    "sync_id",
  ]),
  user_sessions: new Set([
    "id",
    "user_id",
    "session_start",
    "session_end",
    "ip_address",
    "user_agent",
    "status",
    "created_at",
    "sync_id",
  ]),
  messages: new Set([
    "id",
    "sender_id",
    "receiver_id",
    "content",
    "created_at",
    "file_url",
    "file_name",
    "file_type",
    "group_id",
    "read_at",
    "read",
    "sync_id",
  ]),
  financial_transactions: new Set([
    "id",
    "transaction_date",
    "type",
    "amount",
    "budget_head_id",
    "description",
    "reference_type",
    "reference_id",
    "department",
    "created_by",
    "created_at",
    "updated_at",
    "updatedAt",
    "updatedBy",
    "deviceId",
    "sync_id",
  ]),
  asset_depreciation: new Set([
    "id",
    "inventory_id",
    "asset_name",
    "original_cost",
    "current_value",
    "depreciation_rate",
    "monthly_depreciation",
    "total_depreciation",
    "calculation_date",
    "created_at",
    "updatedAt",
    "updatedBy",
    "deviceId",
    "sync_id",
  ]),
  report_inventory: new Set([
    "id",
    "item_name",
    "description",
    "category",
    "uom",
    "unit_cost_price",
    "depreciation_rate",
    "supplier",
    "created_at",
    "updated_at",
    "quantity",
    "head_id",
    "support_doc",
    "item_id",
    "amount",
    "updatedAt",
    "updatedBy",
    "deviceId",
    "sync_id",
  ]),
  teacher_discipline_cases: new Set([
    "id",
    "teacher_id",
    "class_id",
    "case_description",
    "status",
    "recorded_by",
    "recorded_at",
    "resolved_at",
    "resolved_by",
    "resolution_notes",
    "case_name",
    "description",
    "created_by",
    "created_at",
    "updated_at",
    "updatedAt",
    "updatedBy",
    "deviceId",
    "sync_id",
  ]),
  staff_attendance_records: new Set([
    "id",
    "date",
    "staff_name",
    "time_in",
    "time_out",
    "classes_taught",
    "status",
    "created_at",
    "updated_at",
    "sync_id",
  ]),
  staff_employment_status: new Set([
    "id",
    "staff_name",
    "employment_type",
    "created_at",
    "updated_at",
    "sync_id",
  ]),
  cnps_preferences: new Set([
    "user_id",
    "excluded",
    "updated_at",
    "updatedAt",
    "updatedBy",
    "deviceId",
    "sync_id",
  ]),
  salaries: new Set([
    "id",
    "amount",
    "month",
    "paid",
    "paid_at",
    "created_at",
    "user_id",
    "year",
    "status",
    "updated_at",
    "applicant_id",
    "updatedAt",
    "updatedBy",
    "deviceId",
    "sync_id",
  ]),
  academic_bands: new Set([
    "id",
    "band_min",
    "band_max",
    "comment",
    "academic_year_id",
    "class_id",
    "created_at",
    "updated_at",
    "updatedAt",
    "updatedBy",
    "deviceId",
    "sync_id",
  ]),
  class_masters: new Set([
    "id",
    "name",
    "class_id",
    "createdAt",
    "updatedAt",
    "updatedBy",
    "deviceId",
    "sync_id",
  ]),
  specialty_classes: new Set(["id", "specialty_id", "class_id", "sync_id"]),
  class_subjects: new Set([
    "id",
    "class_id",
    "subject_id",
    "teacher_id",
    "createdAt",
    "updatedAt",
    "deletedAt",
    "deleted_at",
    "department_id",
    "updatedBy",
    "deviceId",
    "sync_id",
  ]),
  subject_coefficients: new Set([
    "id",
    "class_id",
    "subject_id",
    "coefficient",
    "created_at",
    "updated_at",
    "sync_id",
  ]),
  subject_classifications: new Set([
    "id",
    "class_id",
    "subject_id",
    "classification_type",
    "created_at",
    "updated_at",
    "sync_id",
  ]),
  teacher_assignments: new Set([
    "id",
    "teacher_id",
    "class_id",
    "subject_id",
    "periods_per_week",
    "created_at",
    "updated_at",
    "updatedAt",
    "updatedBy",
    "deviceId",
    "sync_id",
  ]),
  timetables: new Set([
    "id",
    "class_id",
    "data",
    "created_at",
    "updated_at",
    "updatedAt",
    "updatedBy",
    "deviceId",
    "sync_id",
  ]),
  cases: new Set([
    "id",
    "case_number",
    "student_id",
    "class_id",
    "issue_type",
    "issue_description",
    "status",
    "priority",
    "assigned_to",
    "created_by",
    "started_date",
    "resolved_date",
    "sessions_completed",
    "sessions_scheduled",
    "notes",
    "created_at",
    "updated_at",
    "updatedAt",
    "updatedBy",
    "deviceId",
    "sync_id",
  ]),
  discipline_cases: new Set([
    "id",
    "student_id",
    "class_id",
    "case_description",
    "status",
    "recorded_by",
    "recorded_at",
    "resolved_at",
    "resolved_by",
    "resolution_notes",
    "teacher_id",
    "case_type",
    "updatedAt",
    "updatedBy",
    "deviceId",
    "sync_id",
  ]),
  marks: new Set([
    "id",
    "student_id",
    "subject_id",
    "class_id",
    "academic_year_id",
    "term_id",
    "sequence_id",
    "score",
    "uploaded_by",
    "uploaded_at",
    "createdAt",
    "updatedAt",
    "deletedAt",
    "updatedBy",
    "deviceId",
    "sync_id",
  ]),
  fees: new Set([
    "id",
    "student_id",
    "class_id",
    "fee_type",
    "amount",
    "paid_at",
    "updatedAt",
    "updatedBy",
    "deviceId",
    "sync_id",
  ]),
  attendance_sessions: new Set([
    "id",
    "type",
    "class_id",
    "taken_by",
    "session_time",
    "updatedAt",
    "updatedBy",
    "deviceId",
    "sync_id",
  ]),
  hod_teachers: new Set([
    "id",
    "hod_id",
    "teacher_id",
    "created_at",
    "sync_id",
  ]),
  group_participants: new Set([
    "id",
    "group_id",
    "user_id",
    "joined_at",
    "sync_id",
  ]),
  attendance_records: new Set([
    "id",
    "session_id",
    "student_id",
    "status",
    "marked_at",
    "teacher_id",
    "updatedAt",
    "updatedBy",
    "deviceId",
    "sync_id",
  ]),
  case_sessions: new Set([
    "id",
    "case_id",
    "session_date",
    "session_time",
    "session_type",
    "session_notes",
    "status",
    "created_by",
    "created_at",
    "updated_at",
    "updatedAt",
    "updatedBy",
    "deviceId",
    "sync_id",
  ]),
  case_reports: new Set([
    "id",
    "case_id",
    "report_type",
    "report_content",
    "report_file_url",
    "sent_to",
    "sent_by",
    "sent_at",
    "updatedAt",
    "updatedBy",
    "deviceId",
    "sync_id",
  ]),
};

// ── Scope resolution ──────────────────────────────────────────────────────────

async function resolveUserScope(userId, role) {
  if (FULL_ADMIN_ROLES.includes(role)) {
    return {
      classIds: null,
      subjectIds: null,
      isFullAdmin: true,
      isAdminRole: true,
    };
  }

  const isAdminRole = ADMIN_ROLES.includes(role);

  const { rows } = await pool.query(
    `SELECT DISTINCT cs.class_id, cs.subject_id
     FROM class_subjects cs WHERE cs.teacher_id = $1
     UNION
     SELECT DISTINCT ta.class_id, NULL AS subject_id
     FROM teacher_assignments ta WHERE ta.teacher_id = $1`,
    [userId]
  );

  const classIds = [...new Set(rows.map((r) => r.class_id).filter(Boolean))];
  const subjectIds = [
    ...new Set(rows.map((r) => r.subject_id).filter(Boolean)),
  ];

  return { classIds, subjectIds, isFullAdmin: false, isAdminRole };
}

// ── Conflict logging ──────────────────────────────────────────────────────────

async function logConflict({
  tableName,
  syncId,
  clientUpdatedAt,
  serverUpdatedAt,
  clientData,
  serverData,
  userId,
  deviceId,
}) {
  try {
    await sequelize.query(
      `INSERT INTO change_logs
        (table_name, record_id, change_type, changed_at, changed_by,
         old_value, new_value, source, synced, sync_id)
       VALUES
        (:tableName, :syncId, 'conflict_rejected', NOW(), :userId,
         :clientData, :serverData, 'desktop_delta', false, gen_random_uuid())`,
      {
        replacements: {
          tableName,
          syncId,
          userId,
          deviceId,
          clientUpdatedAt: clientUpdatedAt?.toISOString() ?? null,
          serverUpdatedAt: serverUpdatedAt?.toISOString() ?? null,
          clientData: JSON.stringify(clientData),
          serverData: JSON.stringify(serverData),
        },
      }
    );
  } catch (err) {
    console.error("[DeltaController] Failed to log conflict:", err.message);
  }
}

// ── Table name resolution ─────────────────────────────────────────────────────

function resolveTableName(tableKey) {
  const config = SCOPE_CONFIG[tableKey];
  if (!config || !config.model) return tableKey;
  const model = models[config.model];
  if (!model) return tableKey;
  let name = model.getTableName();
  if (typeof name === "object" && name !== null) name = name.tableName;
  return name || tableKey;
}

// ── Push: apply incoming client records with LWW ──────────────────────────────

function sanitizeRecordForServer(record, tableName) {
  const allowed = TABLE_COLUMNS[tableName];
  const immutable = new Set(["id"]);
  const clientOnly = new Set(["isDirty", "is_dirty", "syncId"]);

  const data = {};
  for (const [key, value] of Object.entries(record)) {
    if (immutable.has(key)) continue;
    if (clientOnly.has(key)) continue;
    // If we have an allowlist for this table, only include known columns
    if (allowed && !allowed.has(key)) continue;
    data[key] = value;
  }
  return data;
}

async function applyRecord({
  tableKey,
  tableName,
  record,
  serverNow,
  clockOffset,
  userId,
  deviceId,
}) {
  const syncId = record.sync_id || record.syncId;
  if (!syncId) {
    console.warn(
      `[DeltaController] Record in "${tableKey}" missing syncId — skipping`
    );
    return "skipped";
  }

  const ts = TABLE_TS[tableName] || {};

  // Calibrate the client's updatedAt using the clock offset.
  // The client may have sent updatedAtSq (renamed) — treat it as updatedAt.
  let clientUpdatedAt = null;
  const rawUpdatedAt =
    record.updatedAt || record.updated_at || record.updatedAtSq;
  if (rawUpdatedAt) {
    const clientMs = new Date(rawUpdatedAt).getTime();
    clientUpdatedAt = new Date(clientMs + clockOffset);
  }

  try {
    // Build SELECT to get the server's current timestamp for LWW comparison
    const tsCols = [];
    if (ts.updatedAt) tsCols.push('"updatedAt"');
    if (ts.updated_at) tsCols.push("updated_at");
    const tsSelect = tsCols.length ? `, ${tsCols.join(", ")}` : "";

    const { rows: existing } = await pool.query(
      `SELECT id, sync_id${tsSelect} FROM "${tableName}" WHERE sync_id = $1 LIMIT 1`,
      [syncId]
    );

    if (existing.length === 0) {
      await insertNewRecord(tableName, record, serverNow, userId, deviceId);
      return "inserted";
    }

    const serverRecord = existing[0];
    const serverUpdatedAt =
      serverRecord.updatedAt || serverRecord.updated_at || null;

    const serverMs = serverUpdatedAt ? new Date(serverUpdatedAt).getTime() : 0;
    const clientMs = clientUpdatedAt ? clientUpdatedAt.getTime() : 0;

    if (clientMs > serverMs) {
      await updateServerRecord(
        tableName,
        syncId,
        record,
        serverNow,
        userId,
        deviceId
      );
      return "applied";
    } else {
      if (clientMs < serverMs) {
        await logConflict({
          tableName,
          syncId,
          clientUpdatedAt,
          serverUpdatedAt: new Date(serverMs),
          clientData: record,
          serverData: serverRecord,
          userId,
          deviceId,
        });
      }
      return "rejected";
    }
  } catch (err) {
    console.error(
      `[DeltaController] applyRecord error for "${tableKey}" syncId=${syncId}:`,
      err.message
    );
    throw err;
  }
}

async function insertNewRecord(tableName, record, serverNow, userId, deviceId) {
  const ts = TABLE_TS[tableName] || {};
  const excluded = new Set(["id"]);

  // Sanitize: strip client-only fields, non-existent columns
  const data = sanitizeRecordForServer(record, tableName);

  // Set server timestamps
  if (ts.updatedAt) data.updatedAt = serverNow;
  if (ts.updated_at) data.updated_at = serverNow;
  data.updatedBy = userId;
  data.deviceId = deviceId || null;

  const cols = Object.keys(data).filter(
    (k) => !excluded.has(k) && data[k] !== undefined
  );
  if (!cols.length) return;

  const placeholders = cols.map((_, i) => `$${i + 1}`).join(", ");
  const values = cols.map((c) => data[c]);

  const sql = `
    INSERT INTO "${tableName}" (${cols.map((c) => `"${c}"`).join(", ")})
    VALUES (${placeholders})
    ON CONFLICT (sync_id) DO NOTHING
  `;

  await pool.query(sql, values);
}

async function updateServerRecord(
  tableName,
  syncId,
  record,
  serverNow,
  userId,
  deviceId
) {
  const ts = TABLE_TS[tableName] || {};
  const immutable = new Set(["id", "sync_id", "syncId"]);

  // Sanitize: strip client-only fields, non-existent columns
  const data = sanitizeRecordForServer(record, tableName);

  // Set server timestamps
  if (ts.updatedAt) data.updatedAt = serverNow;
  if (ts.updated_at) data.updated_at = serverNow;
  data.updatedBy = userId;
  data.deviceId = deviceId || null;

  const cols = Object.keys(data).filter(
    (k) => !immutable.has(k) && data[k] !== undefined
  );

  if (!cols.length) return;

  const setClauses = cols.map((c, i) => `"${c}" = $${i + 1}`).join(", ");
  const values = cols.map((c) => data[c]);
  values.push(syncId);

  const sql = `
    UPDATE "${tableName}"
    SET ${setClauses}
    WHERE sync_id = $${values.length}
  `;

  await pool.query(sql, values);
}

// ── Pull: fetch server changes since lastSyncAt ───────────────────────────────

function buildPullWhere(tableKey, scope, since, params) {
  const config = SCOPE_CONFIG[tableKey];
  if (!config || config.strategy === STRATEGY.NEVER) return null;

  const ts = TABLE_TS[tableKey];
  if (!ts || !ts.pull_ts) {
    // Table has no timestamp column at all — skip pull for this table
    // (specialty_classes is insert-only, managed server-side)
    return null;
  }

  const { classIds, subjectIds, isFullAdmin, isAdminRole, userId } = scope;
  const isAppendOnly = APPEND_ONLY_TABLES.has(tableKey);

  const sinceParam = `$${params.length + 1}`;
  params.push(since);
  const timeClause = `${ts.pull_ts} > ${sinceParam}`;

  if (config.strategy === STRATEGY.PUBLIC) return timeClause;

  if (config.strategy === STRATEGY.FULL_FOR_ROLES) {
    if (!config.allowedRoles.includes(scope.role)) return null;
    return timeClause;
  }

  if (config.strategy === STRATEGY.OWNED) {
    if (tableKey === "User") return timeClause;

    if (tableKey === "DisciplineCase") {
      const fullRoles = [...ADMIN_ROLES, ROLES.DISCIPLINE, ROLES.PSYCHOSOCIAL];
      if (fullRoles.includes(scope.role)) return timeClause;
      const p = `$${params.length + 1}`;
      params.push(userId);
      return `(recorded_by = ${p} OR teacher_id = ${p}) AND ${timeClause}`;
    }

    if (tableKey === "Specialty") {
      if (isFullAdmin) return timeClause;
      if (!classIds?.length) return null;
      const p = `$${params.length + 1}`;
      params.push(classIds);
      return `id IN (SELECT specialty_id FROM specialty_classes WHERE class_id = ANY(${p})) AND ${timeClause}`;
    }

    if (tableKey === "Group") {
      const p = `$${params.length + 1}`;
      params.push(userId);
      return `id IN (SELECT group_id FROM group_participants WHERE user_id = ${p}) AND ${timeClause}`;
    }

    if (tableKey === "GroupParticipant") {
      const p = `$${params.length + 1}`;
      params.push(userId);
      return `group_id IN (SELECT group_id FROM group_participants WHERE user_id = ${p}) AND ${timeClause}`;
    }

    if (tableKey === "Message") {
      const p = `$${params.length + 1}`;
      params.push(userId);
      return `(sender_id = ${p} OR receiver_id = ${p} OR group_id IN (SELECT group_id FROM group_participants WHERE user_id = ${p})) AND ${timeClause}`;
    }

    if (tableKey === "AttendanceRecord") {
      if (isFullAdmin) return timeClause;
      if (!classIds?.length) return null;
      const p = `$${params.length + 1}`;
      params.push(classIds);
      return `session_id IN (SELECT id FROM attendance_sessions WHERE class_id = ANY(${p})) AND ${timeClause}`;
    }

    if (tableKey === "Fee") {
      if (isAdminRole) return timeClause;
      if (!classIds?.length) return null;
      const p = `$${params.length + 1}`;
      params.push(classIds);
      return `student_id IN (SELECT id FROM students WHERE class_id = ANY(${p})) AND ${timeClause}`;
    }

    const filterKey = config.filterKey || "class_id";
    switch (config.filterType) {
      case "BY_CLASS_IDS": {
        if (isFullAdmin) return timeClause;
        if (!classIds?.length) return null;
        const p = `$${params.length + 1}`;
        params.push(classIds);
        return `"${filterKey}" = ANY(${p}) AND ${timeClause}`;
      }
      case "BY_SUBJECT_IDS": {
        if (isFullAdmin) return timeClause;
        if (!subjectIds?.length) return null;
        const p = `$${params.length + 1}`;
        params.push(subjectIds);
        return `id = ANY(${p}) AND ${timeClause}`;
      }
      case "BY_CLASS_AND_SUBJECT": {
        if (isFullAdmin) return timeClause;
        if (!classIds?.length || !subjectIds?.length) return null;
        const p1 = `$${params.length + 1}`;
        params.push(classIds);
        const p2 = `$${params.length + 1}`;
        params.push(subjectIds);
        return `class_id = ANY(${p1}) AND subject_id = ANY(${p2}) AND ${timeClause}`;
      }
      case "BY_USER_ID": {
        if (isAdminRole) return timeClause;
        const p = `$${params.length + 1}`;
        params.push(userId);
        return `"${filterKey}" = ${p} AND ${timeClause}`;
      }
      case "BY_USER_ID_ONLY": {
        const p = `$${params.length + 1}`;
        params.push(userId);
        return `"${filterKey}" = ${p} AND ${timeClause}`;
      }
      default:
        return timeClause;
    }
  }

  return null;
}

async function pullChanges(userId, role, lastSyncAt, scope) {
  scope.userId = userId;
  scope.role = role;

  const changes = {};

  for (const tableKey of SYNC_ORDER) {
    const config = SCOPE_CONFIG[tableKey];
    if (!config || config.strategy === STRATEGY.NEVER) continue;

    const tableName = resolveTableName(tableKey);
    const since = lastSyncAt[tableKey] || lastSyncAt["*"] || null;
    if (!since) continue;

    const params = [];
    const whereClause = buildPullWhere(tableKey, scope, since, params);
    if (whereClause === null) continue;

    const fks = FK_MAP[tableName] || [];
    const joinClauses = [];
    const extraSelects = [];
    const aliasCount = {};

    for (const { col, refTable } of fks) {
      const aliasBase = refTable.replace(/[^a-zA-Z0-9]/g, "_");
      aliasCount[aliasBase] = (aliasCount[aliasBase] || 0) + 1;
      const alias = `${aliasBase}_${aliasCount[aliasBase]}`;
      joinClauses.push(
        `LEFT JOIN "${refTable}" ${alias} ON ${alias}.id = t."${col}"`
      );
      extraSelects.push(`${alias}.sync_id AS "${col}__sync_id"`);
    }

    const selectClause =
      extraSelects.length > 0 ? `t.*, ${extraSelects.join(", ")}` : "t.*";
    const joins = joinClauses.join("\n      ");

    const finalSelect =
      tableKey === "User"
        ? `t.id, t.sync_id, t.username, t.name, t.email, t.contact,
           t.gender, t.role, t.suspended, t."createdAt", t."updatedAt",
           t."deletedAt", t."updatedBy", t."deviceId", t."scopeVersion",
           t."forceOnlineLogin"${
             extraSelects.length ? ", " + extraSelects.join(", ") : ""
           }`
        : selectClause;

    const limitParam = `$${params.length + 1}`;
    params.push(MAX_PULL_RECORDS_PER_TABLE);

    const sql = `
      SELECT ${finalSelect}
      FROM "${tableName}" t
      ${joins}
      WHERE ${whereClause}
      ORDER BY t.id
      LIMIT ${limitParam}
    `;

    try {
      const { rows } = await pool.query(sql, params);
      if (rows.length > 0) {
        changes[tableKey] = rows;
      }
    } catch (err) {
      console.error(
        `[DeltaController] Pull error for "${tableKey}":`,
        err.message
      );
    }
  }

  return changes;
}

// ── Main endpoint ─────────────────────────────────────────────────────────────

const deltaSync = async (req, res) => {
  const serverNow = new Date();
  const serverTime = serverNow.getTime();

  try {
    const { id: userId, role } = req.user;
    const deviceId = req.headers["x-device-token"] || null;

    const { clientTime, lastSyncAt, push: pushPayload } = req.body;

    if (!lastSyncAt || typeof lastSyncAt !== "object") {
      return res.status(400).json({ error: "lastSyncAt is required" });
    }

    const clockOffset = clientTime ? serverTime - Number(clientTime) : 0;

    const scope = await resolveUserScope(userId, role);
    scope.userId = userId;
    scope.role = role;

    // ── Phase 1: Push ─────────────────────────────────────────────────────────

    const pushResults = {
      applied: 0,
      inserted: 0,
      rejected: 0,
      skipped: 0,
      errors: 0,
    };

    if (pushPayload && typeof pushPayload === "object") {
      for (const [tableKey, records] of Object.entries(pushPayload)) {
        if (!Array.isArray(records) || records.length === 0) continue;

        const config = SCOPE_CONFIG[tableKey];
        if (!config || config.strategy === STRATEGY.NEVER) {
          console.warn(
            `[DeltaController] Client pushed to non-sync table "${tableKey}" — ignored`
          );
          pushResults.skipped += records.length;
          continue;
        }

        const toProcess = records.slice(0, MAX_PUSH_RECORDS);
        if (records.length > MAX_PUSH_RECORDS) {
          console.warn(
            `[DeltaController] userId=${userId} pushed ${records.length} records ` +
              `for "${tableKey}" — capped at ${MAX_PUSH_RECORDS}`
          );
        }

        if (APPEND_ONLY_TABLES.has(tableKey)) {
          pushResults.skipped += toProcess.length;
          continue;
        }

        const tableName = resolveTableName(tableKey);

        for (const record of toProcess) {
          try {
            const result = await applyRecord({
              tableKey,
              tableName,
              record,
              serverNow,
              clockOffset,
              userId,
              deviceId,
            });

            pushResults[
              result === "applied"
                ? "applied"
                : result === "inserted"
                ? "inserted"
                : result === "rejected"
                ? "rejected"
                : "skipped"
            ]++;
          } catch (err) {
            pushResults.errors++;
            console.error(
              `[DeltaController] Record apply error "${tableKey}":`,
              err.message
            );
          }
        }
      }
    }

    // ── Phase 2: Pull ─────────────────────────────────────────────────────────

    const pullResult = await pullChanges(userId, role, lastSyncAt, scope);

    // ── Response ──────────────────────────────────────────────────────────────

    return res.status(200).json({
      serverTime,
      clockOffset,
      push: pushResults,
      pull: pullResult,
    });
  } catch (err) {
    console.error("[DeltaController] deltaSync error:", err.message);
    return res.status(500).json({ error: "Delta sync failed" });
  }
};

module.exports = { deltaSync };
