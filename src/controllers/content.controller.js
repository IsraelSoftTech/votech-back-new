const { StatusCodes } = require("http-status-codes");
const models = require("../models/index.model");
const appResponder = require("../utils/appResponder");
const catchAsync = require("../utils/catchAsync");
const { where } = require("sequelize");

const subjectsData = catchAsync(async (req, res, next) => {
  const subjects = await models.Subject.count();

  const assignedSubjectsResult = await models.ClassSubject.findAll({
    attributes: ["subject_id"],
    group: ["subject_id"],
  });
  const assignedSubjects = assignedSubjectsResult.length;

  appResponder(
    StatusCodes.OK,
    {
      stats: [
        {
          title: "Number of Subjects",
          value: subjects,
        },
        {
          title: "Assigned Subjects",
          value: assignedSubjects,
        },
        {
          title: "Unassigned Subjects",
          value: subjects - assignedSubjects,
        },
      ],
    },
    res
  );
});

const academicYearData = catchAsync(async (req, res, next) => {
  const total = await models.AcademicYear.count();
  const archived = (
    await models.AcademicYear.findAll({
      where: { status: "archived" },
    })
  ).length;

  appResponder(
    StatusCodes.OK,
    {
      stats: [
        {
          title: "Number of Academic Years",
          value: total,
        },
        {
          title: "Archived Academic Years",
          value: archived,
        },
      ],
    },
    res
  );
});

const classesData = catchAsync(async (req, res, next) => {
  const total = await models.Class.count();
  const archived = (
    await models.Class.findAll({
      where: { suspended: true },
    })
  ).length;

  appResponder(
    StatusCodes.OK,
    {
      stats: [
        {
          title: "Total Number of Classes",
          value: total,
        },
        {
          title: "Number of Active Classes",
          value: total - archived,
        },
        {
          title: "Number of Suspended Classes",
          value: archived,
        },
      ],
    },
    res
  );
});

module.exports = {
  subjectsData,
  academicYearData,
  classesData,
};
