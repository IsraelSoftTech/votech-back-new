const { sequelize, DataTypes } = require("../db");

const Subject = require("./Subject.model")(sequelize, DataTypes);
const ClassSubject = require("./ClassSubject.model")(sequelize, DataTypes);
const Class = require("./classes")(sequelize, DataTypes);
const Teacher = require("./teachers")(sequelize, DataTypes);
const Mark = require("./Mark.model")(sequelize, DataTypes);
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

console.log({
  Subject,
  ClassSubject,
  Class,
  Teacher,
  Mark,
  users,
  students,
  Term,
  Sequence,
  ReportCardComment,
  ReportCardSnapshot,
  AcademicYear,
});

const models = {
  Subject,
  ClassSubject,
  Class,
  Teacher,
  Mark,
  users,
  students,
  AcademicYear,
  Term,
  Sequence,
  ReportCardComment,
  ReportCardSnapshot,
};

// Call associate after all models are initialized
Object.values(models).forEach((model) => {
  if (typeof model.associate === "function") {
    model.associate(models);
  }
});

module.exports = models;
