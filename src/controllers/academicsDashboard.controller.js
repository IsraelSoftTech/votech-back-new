"use strict";

const { Op } = require("sequelize");
const { StatusCodes } = require("http-status-codes");
const models = require("../models/index.model");
const { sequelize } = require("../db");
const catchAsync = require("../utils/catchAsync");
const appResponder = require("../utils/appResponder");

// Admin3's dedicated dashboard — everything here is real, already-existing
// data, no new tables. The time period only scopes ACTIVITY (student
// registrations, promotion runs, report-card sessions) — structural
// counts (classes/subjects/departments/academic years) are "what
// currently exists," not something that happened within a period, so
// they're always current-state totals regardless of the selected period.

const PERIODS = ["this_month", "last_3_months", "this_academic_year", "all_time"];

async function resolvePeriodRange(period, activeAcademicYear) {
  const now = new Date();
  if (period === "this_month") {
    return { start: new Date(now.getFullYear(), now.getMonth(), 1), end: now };
  }
  if (period === "last_3_months") {
    const start = new Date(now);
    start.setMonth(start.getMonth() - 3);
    return { start, end: now };
  }
  if (period === "this_academic_year" && activeAcademicYear) {
    return { start: new Date(activeAcademicYear.start_date), end: now };
  }
  return null; // all_time — no range filter
}

const getDashboardSummary = catchAsync(async (req, res) => {
  const period = PERIODS.includes(req.query.period) ? req.query.period : "all_time";

  const activeAcademicYear = await models.AcademicYear.findOne({ where: { status: "active" } });
  const range = await resolvePeriodRange(period, activeAcademicYear);
  const dateWhere = range ? { [Op.between]: [range.start, range.end] } : undefined;

  // ── Student population (activity-scoped by registration_date) ──
  const studentWhere = dateWhere ? { registration_date: dateWhere } : {};

  const [total, byGenderRaw, byStatusRaw, byClassRaw] = await Promise.all([
    models.Student.count({ where: studentWhere }),
    models.Student.findAll({
      where: studentWhere,
      attributes: ["sex", [sequelize.fn("COUNT", sequelize.col("students.id")), "count"]],
      group: ["sex"],
      raw: true,
    }),
    models.Student.findAll({
      where: studentWhere,
      attributes: ["status", [sequelize.fn("COUNT", sequelize.col("students.id")), "count"]],
      group: ["status"],
      raw: true,
    }),
    models.Student.findAll({
      where: studentWhere,
      attributes: [
        "class_id",
        [sequelize.fn("COUNT", sequelize.col("students.id")), "count"],
      ],
      include: [{ association: models.Student.associations.Class, attributes: ["name", "department_id"] }],
      group: ["class_id", "Class.id", "Class.name", "Class.department_id"],
      raw: true,
    }),
  ]);

  const byGender = {};
  for (const row of byGenderRaw) byGender[row.sex || "Unspecified"] = Number(row.count);

  const byStatus = {};
  for (const row of byStatusRaw) byStatus[row.status] = Number(row.count);

  const byClass = byClassRaw
    .map((row) => ({
      class_id: row.class_id,
      class_name: row["Class.name"] || "Unassigned",
      department_id: row["Class.department_id"] || null,
      count: Number(row.count),
    }))
    .sort((a, b) => b.count - a.count);

  const byDepartmentMap = new Map();
  for (const row of byClass) {
    if (!row.department_id) continue;
    byDepartmentMap.set(row.department_id, (byDepartmentMap.get(row.department_id) || 0) + row.count);
  }
  const departments = await models.Specialty.findAll({ attributes: ["id", "name"], raw: true });
  const byDepartment = departments
    .map((d) => ({ department_id: d.id, department_name: d.name, count: byDepartmentMap.get(d.id) || 0 }))
    .filter((d) => d.count > 0)
    .sort((a, b) => b.count - a.count);

  // Daily registration trend within the period (all_time falls back to
  // every registration on record, same as the old dashboard's chart).
  const trendWhere = { ...studentWhere, registration_date: { [Op.ne]: null } };
  const trendRows = await models.Student.findAll({
    where: trendWhere,
    attributes: [
      "registration_date",
      [sequelize.fn("COUNT", sequelize.col("students.id")), "count"],
    ],
    group: ["registration_date"],
    order: [["registration_date", "ASC"]],
    raw: true,
  });
  let cumulative = 0;
  const trend = trendRows.map((row) => {
    cumulative += Number(row.count);
    return { date: row.registration_date, registered: Number(row.count), cumulative };
  });

  // ── Academic structure (always current-state, not period-scoped) ──
  // orientationTotal/orientationWithChoice are two separate counts, not
  // one query with an optional department_choices include — that hasMany
  // join would multiply each student's row once per recorded choice (up
  // to 6), silently inflating both counts.
  const [classCount, subjectCount, academicYearCount, departmentCount, allClasses, orientationTotal, orientationWithChoice] =
    await Promise.all([
      models.Class.count(),
      models.Subject.count(),
      models.AcademicYear.count(),
      models.Specialty.count(),
      models.Class.findAll({ attributes: ["id", "department_id", "is_orientation"], raw: true }),
      models.Student.count({
        where: { status: "active" },
        include: [{ association: models.Student.associations.Class, where: { is_orientation: true }, attributes: [] }],
      }),
      models.Student.count({
        where: { status: "active" },
        distinct: true,
        col: "id",
        include: [
          { association: models.Student.associations.Class, where: { is_orientation: true }, attributes: [] },
          { association: models.Student.associations.department_choices, required: true, attributes: [] },
        ],
      }),
    ]);

  const classesByDepartmentMap = new Map();
  for (const c of allClasses) {
    classesByDepartmentMap.set(c.department_id, (classesByDepartmentMap.get(c.department_id) || 0) + 1);
  }
  const classesByDepartment = departments
    .map((d) => ({ department_id: d.id, department_name: d.name, count: classesByDepartmentMap.get(d.id) || 0 }))
    .filter((d) => d.count > 0)
    .sort((a, b) => b.count - a.count);

  // ── Promotion activity (scoped to runs initiated within the period) ──
  const promoWhere = dateWhere ? { initiated_at: dateWhere } : {};
  const [latestRun, stalledCount] = await Promise.all([
    models.PromotionRun.findOne({
      where: promoWhere,
      order: [["id", "DESC"]],
      include: [
        { association: models.PromotionRun.associations.academic_year_from },
        { association: models.PromotionRun.associations.academic_year_to },
        { association: models.PromotionRun.associations.moves },
      ],
    }),
    models.PromotionRun.count({ where: { ...promoWhere, interruption_count: { [Op.gt]: 0 } } }),
  ]);

  const promotion = {
    latestRun: latestRun
      ? {
          id: latestRun.id,
          status: latestRun.status,
          scope: latestRun.scope,
          initiated_at: latestRun.initiated_at,
          academic_year_from: latestRun.academic_year_from?.name || null,
          academic_year_to: latestRun.academic_year_to?.name || null,
          processed_students: (latestRun.moves || []).reduce(
            (sum, m) => sum + (m.processed_students || 0),
            0
          ),
          interruption_count: latestRun.interruption_count,
        }
      : null,
    stalledCount,
  };

  // ── Report card activity (scoped to sessions started within the period) ──
  const rcWhere = dateWhere ? { created_at: dateWhere } : {};
  const latestSession = await models.ReportCardSession.findOne({
    where: rcWhere,
    order: [["id", "DESC"]],
    include: [{ association: models.ReportCardSession.associations.academic_year }],
  });

  const unreadNotifications = await models.AcademicJobNotification.count({
    where: {
      [Op.or]: [{ user_id: req.user.id }, { role: req.user.role }],
      read_at: null,
    },
  });

  const reportCards = {
    latestSession: latestSession
      ? {
          id: latestSession.id,
          status: latestSession.status,
          term: latestSession.term,
          academic_year: latestSession.academic_year?.name || null,
          total_classes: latestSession.total_classes,
          completed_classes: latestSession.completed_classes,
          failed_classes: latestSession.failed_classes,
          created_at: latestSession.created_at,
        }
      : null,
    unreadNotifications,
  };

  appResponder(
    StatusCodes.OK,
    {
      period,
      periodRange: range,
      students: { total, byGender, byStatus, byClass, byDepartment, trend },
      structure: {
        classCount,
        subjectCount,
        academicYearCount,
        activeAcademicYear: activeAcademicYear?.name || null,
        departmentCount,
        classesByDepartment,
        orientation: { total: orientationTotal, withChoice: orientationWithChoice },
      },
      promotion,
      reportCards,
    },
    res
  );
});

module.exports = { getDashboardSummary };
