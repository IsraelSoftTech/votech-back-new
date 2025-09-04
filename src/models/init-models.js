var DataTypes = require("sequelize").DataTypes;
var _academic_years = require("./academic_years");
var _attendance_records = require("./attendance_records");
var _attendance_sessions = require("./attendance_sessions");


var _classes = require("./classes");
var _fees = require("./fees");
var _group_participants = require("./group_participants");
var _groups = require("./groups");
var _id_cards = require("./id_cards");
var _inventory = require("./inventory");
var _lesson_plans = require("./lesson_plans");
var _lessons = require("./lessons");
var _messages = require("./messages");
var _salaries = require("./salaries");
var _salary_descriptions = require("./salary_descriptions");
var _specialties = require("./specialties");
var _specialty_classes = require("./specialty_classes");
var _students = require("./students");
var _subject_classifications = require("./subject_classifications");
var _subject_coefficients = require("./subject_coefficients");
var _subjects = require("./subjects");
var _teacher_assignments = require("./teacher_assignments");
var _teachers = require("./teachers");
var _timetable_configs = require("./timetable_configs");
var _timetables = require("./timetables");
var _user_activities = require("./user_activities");
var _user_sessions = require("./user_sessions");
var _users = require("./users");
var _vocational = require("./vocational");

function initModels(sequelize) {
  var academic_years = _academic_years(sequelize, DataTypes);
  var attendance_records = _attendance_records(sequelize, DataTypes);
  var attendance_sessions = _attendance_sessions(sequelize, DataTypes);


  var classes = _classes(sequelize, DataTypes);
  var fees = _fees(sequelize, DataTypes);
  var group_participants = _group_participants(sequelize, DataTypes);
  var groups = _groups(sequelize, DataTypes);
  var id_cards = _id_cards(sequelize, DataTypes);
  var inventory = _inventory(sequelize, DataTypes);
  var lesson_plans = _lesson_plans(sequelize, DataTypes);
  var lessons = _lessons(sequelize, DataTypes);
  var messages = _messages(sequelize, DataTypes);
  var salaries = _salaries(sequelize, DataTypes);
  var salary_descriptions = _salary_descriptions(sequelize, DataTypes);
  var specialties = _specialties(sequelize, DataTypes);
  var specialty_classes = _specialty_classes(sequelize, DataTypes);
  var students = _students(sequelize, DataTypes);
  var subject_classifications = _subject_classifications(sequelize, DataTypes);
  var subject_coefficients = _subject_coefficients(sequelize, DataTypes);
  var subjects = _subjects(sequelize, DataTypes);
  var teacher_assignments = _teacher_assignments(sequelize, DataTypes);
  var teachers = _teachers(sequelize, DataTypes);
  var timetable_configs = _timetable_configs(sequelize, DataTypes);
  var timetables = _timetables(sequelize, DataTypes);
  var user_activities = _user_activities(sequelize, DataTypes);
  var user_sessions = _user_sessions(sequelize, DataTypes);
  var users = _users(sequelize, DataTypes);
  var vocational = _vocational(sequelize, DataTypes);



  attendance_records.belongsTo(attendance_sessions, { as: "session", foreignKey: "session_id"});
  attendance_sessions.hasMany(attendance_records, { as: "attendance_records", foreignKey: "session_id"});
  attendance_sessions.belongsTo(classes, { as: "class", foreignKey: "class_id"});
  classes.hasMany(attendance_sessions, { as: "attendance_sessions", foreignKey: "class_id"});
  specialty_classes.belongsTo(classes, { as: "class", foreignKey: "class_id"});
  classes.hasMany(specialty_classes, { as: "specialty_classes", foreignKey: "class_id"});
  students.belongsTo(classes, { as: "class", foreignKey: "class_id"});
  classes.hasMany(students, { as: "students", foreignKey: "class_id"});
  subject_classifications.belongsTo(classes, { as: "class", foreignKey: "class_id"});
  classes.hasMany(subject_classifications, { as: "subject_classifications", foreignKey: "class_id"});
  subject_coefficients.belongsTo(classes, { as: "class", foreignKey: "class_id"});
  classes.hasMany(subject_coefficients, { as: "subject_coefficients", foreignKey: "class_id"});
  teacher_assignments.belongsTo(classes, { as: "class", foreignKey: "class_id"});
  classes.hasMany(teacher_assignments, { as: "teacher_assignments", foreignKey: "class_id"});
  timetables.belongsTo(classes, { as: "class", foreignKey: "class_id"});
  classes.hasOne(timetables, { as: "timetable", foreignKey: "class_id"});
  group_participants.belongsTo(groups, { as: "group", foreignKey: "group_id"});
  groups.hasMany(group_participants, { as: "group_participants", foreignKey: "group_id"});
  specialty_classes.belongsTo(specialties, { as: "specialty", foreignKey: "specialty_id"});
  specialties.hasMany(specialty_classes, { as: "specialty_classes", foreignKey: "specialty_id"});
  attendance_records.belongsTo(students, { as: "student", foreignKey: "student_id"});
  students.hasMany(attendance_records, { as: "attendance_records", foreignKey: "student_id"});
  students.belongsTo(specialties, { as: "specialty", foreignKey: "specialty_id"});
  specialties.hasMany(students, { as: "students", foreignKey: "specialty_id"});

  subject_classifications.belongsTo(subjects, { as: "subject", foreignKey: "subject_id"});
  subjects.hasMany(subject_classifications, { as: "subject_classifications", foreignKey: "subject_id"});
  subject_coefficients.belongsTo(subjects, { as: "subject", foreignKey: "subject_id"});
  subjects.hasMany(subject_coefficients, { as: "subject_coefficients", foreignKey: "subject_id"});
  teacher_assignments.belongsTo(subjects, { as: "subject", foreignKey: "subject_id"});
  subjects.hasMany(teacher_assignments, { as: "teacher_assignments", foreignKey: "subject_id"});


  group_participants.belongsTo(users, { as: "user", foreignKey: "user_id"});
  users.hasMany(group_participants, { as: "group_participants", foreignKey: "user_id"});
  groups.belongsTo(users, { as: "creator", foreignKey: "creator_id"});
  users.hasMany(groups, { as: "groups", foreignKey: "creator_id"});
  lesson_plans.belongsTo(users, { as: "reviewed_by_user", foreignKey: "reviewed_by"});
  users.hasMany(lesson_plans, { as: "lesson_plans", foreignKey: "reviewed_by"});
  lesson_plans.belongsTo(users, { as: "user", foreignKey: "user_id"});
  users.hasMany(lesson_plans, { as: "user_lesson_plans", foreignKey: "user_id"});
  lessons.belongsTo(users, { as: "reviewed_by_user", foreignKey: "reviewed_by"});
  users.hasMany(lessons, { as: "lessons", foreignKey: "reviewed_by"});
  lessons.belongsTo(users, { as: "user", foreignKey: "user_id"});
  users.hasMany(lessons, { as: "user_lessons", foreignKey: "user_id"});
  messages.belongsTo(users, { as: "receiver", foreignKey: "receiver_id"});
  users.hasMany(messages, { as: "messages", foreignKey: "receiver_id"});
  messages.belongsTo(users, { as: "sender", foreignKey: "sender_id"});
  users.hasMany(messages, { as: "sender_messages", foreignKey: "sender_id"});
  salaries.belongsTo(users, { as: "user", foreignKey: "user_id"});
  users.hasMany(salaries, { as: "salaries", foreignKey: "user_id"});
  teacher_assignments.belongsTo(users, { as: "teacher", foreignKey: "teacher_id"});
  users.hasMany(teacher_assignments, { as: "teacher_assignments", foreignKey: "teacher_id"});
  teachers.belongsTo(users, { as: "user", foreignKey: "user_id"});
  users.hasMany(teachers, { as: "teachers", foreignKey: "user_id"});
  user_activities.belongsTo(users, { as: "user", foreignKey: "user_id"});
  users.hasMany(user_activities, { as: "user_activities", foreignKey: "user_id"});
  user_sessions.belongsTo(users, { as: "user", foreignKey: "user_id"});
  attendance_sessions.belongsTo(users, { as: "taken_by_user", foreignKey: "taken_by"});
  users.hasMany(attendance_sessions, { as: "attendance_sessions", foreignKey: "taken_by"});
  users.hasMany(user_sessions, { as: "user_sessions", foreignKey: "user_id"});

  return {
    academic_years,
    attendance_records,
    attendance_sessions,
    classes,
    fees,
    group_participants,
    groups,
    id_cards,
    inventory,
    lesson_plans,
    lessons,
    messages,
    salaries,
    salary_descriptions,
    specialties,
    specialty_classes,
    students,
    subject_classifications,
    subject_coefficients,
    subjects,
    teacher_assignments,
    teachers,
    timetable_configs,
    timetables,
    user_activities,
    user_sessions,
    users,
    vocational,
  };
}
module.exports = initModels;
module.exports.initModels = initModels;
module.exports.default = initModels;
