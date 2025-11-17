const { sequelize, DataTypes } = require("../db");

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

console.log({
  Subject,
  ClassSubject,
  Class,
  Teacher,
  marks,
  users,
  students,
  Term,
  Sequence,
  ReportCardComment,
  ReportCardSnapshot,
  AcademicYear,
  specialties,
  specialty_classes,
  academic_bands,
  change_logs,
});

const models = {
  Subject,
  Class,
  ClassSubject,
  Teacher,
  marks,
  users,
  students,
  AcademicYear,
  Term,
  Sequence,
  ReportCardComment,
  ReportCardSnapshot,
  specialties,
  specialty_classes,
  academic_bands,
  change_logs,
};

// Call associate after all models are initialized
Object.values(models).forEach((model) => {
  if (typeof model.associate === "function") {
    model.associate(models);
  }
});

module.exports = models;
