"use strict";
// Seeds a synthetic class with a configurable student count into whatever
// DATABASE_URL is set when this runs, LOCAL TEST DB ONLY, never point this
// at production. Used to reproduce the mass report-card generation crash
// at real scale (up to 1000 students) without needing real student data.
//
// Usage: DATABASE_URL=<local test db> node scripts/seedLoadTestClass.js 1000

const models = require("../src/models/index.model");

const STUDENT_COUNT = Number(process.argv[2]) || 100;
const CLASS_NAME = `LOAD TEST CLASS ${STUDENT_COUNT}`;
const ACADEMIC_YEAR_ID = 1; // the active year in the local test DB

async function main() {
  const guard = String(process.env.DATABASE_URL || "");
  if (!guard.includes("localhost") && !guard.includes("127.0.0.1")) {
    throw new Error(
      `Refusing to seed, DATABASE_URL doesn't look like a local DB: ${guard}`
    );
  }

  const department =
    (await models.Specialty.findOne({ where: { name: "General " } })) ||
    (await models.Specialty.findOne());
  if (!department) throw new Error("No department found to seed against");

  const teacher = await models.User.findOne();
  if (!teacher) throw new Error("No user found to use as a dummy teacher");

  // Clean up a previous run of this exact size first, so this script is
  // safely re-runnable without accumulating cruft across sizes.
  const existing = await models.Class.findOne({ where: { name: CLASS_NAME } });
  if (existing) {
    const studentIds = (
      await models.Student.findAll({ where: { class_id: existing.id }, attributes: ["id"], raw: true })
    ).map((s) => s.id);
    if (studentIds.length) {
      await models.Mark.destroy({ where: { student_id: studentIds } });
      await models.Student.destroy({ where: { id: studentIds }, force: true });
    }
    await models.ClassSubject.destroy({ where: { class_id: existing.id } });
    await models.AcademicBand.destroy({ where: { class_id: existing.id } }).catch(() => {});
    await existing.destroy();
    console.log(`Cleaned up previous "${CLASS_NAME}"`);
  }

  const klass = await models.Class.create({
    name: CLASS_NAME,
    department_id: department.id,
  });
  console.log(`Created class #${klass.id} "${CLASS_NAME}" in department "${department.name}"`);

  // 10 subjects, a realistic curriculum size, mixing general/professional.
  const subjects = await models.Subject.findAll({ limit: 10, order: [["id", "ASC"]] });
  if (subjects.length < 5) throw new Error("Not enough subjects in this DB to seed a curriculum");

  await models.ClassSubject.bulkCreate(
    subjects.map((s) => ({
      class_id: klass.id,
      subject_id: s.id,
      teacher_id: teacher.id,
      department_id: department.id,
    }))
  );
  console.log(`Linked ${subjects.length} subjects to the class`);

  // Students, in batches, so this itself doesn't spike memory.
  const STUDENT_BATCH = 200;
  const studentIds = [];
  for (let i = 0; i < STUDENT_COUNT; i += STUDENT_BATCH) {
    const batchSize = Math.min(STUDENT_BATCH, STUDENT_COUNT - i);
    const rows = Array.from({ length: batchSize }, (_, j) => {
      const n = i + j + 1;
      return {
        full_name: `Load Test Student ${n}`,
        student_id: `LT-${STUDENT_COUNT}-${n}`,
        sex: n % 2 === 0 ? "M" : "F",
        date_of_birth: "2008-01-01",
        place_of_birth: "Bamenda",
        father_name: `Father ${n}`,
        mother_name: `Mother ${n}`,
        registration_date: new Date(),
        class_id: klass.id,
        academic_year_id: ACADEMIC_YEAR_ID,
        status: "active",
      };
    });
    const created = await models.Student.bulkCreate(rows, { returning: true });
    studentIds.push(...created.map((s) => s.id));
    process.stdout.write(`\rStudents seeded: ${studentIds.length}/${STUDENT_COUNT}`);
  }
  console.log("");

  // Marks: term3 = sequences 5 & 6 for academic_year_id 1 (see the
  // Sequence table, order_number 5/6 fall under term_id 3).
  const term3Sequences = await models.Sequence.findAll({
    where: { academic_year_id: ACADEMIC_YEAR_ID, order_number: [5, 6] },
  });
  if (term3Sequences.length !== 2) {
    throw new Error("Expected 2 term-3 sequences in the local test DB (order_number 5 and 6)");
  }

  const MARK_BATCH = 5000;
  let markRows = [];
  let totalMarks = 0;
  for (const studentId of studentIds) {
    for (const subject of subjects) {
      for (const seq of term3Sequences) {
        markRows.push({
          student_id: studentId,
          subject_id: subject.id,
          class_id: klass.id,
          academic_year_id: ACADEMIC_YEAR_ID,
          term_id: seq.term_id,
          sequence_id: seq.id,
          score: Math.round(Math.random() * 20 * 100) / 100,
          uploaded_by: teacher.id,
          uploaded_at: new Date(),
        });
      }
    }
    if (markRows.length >= MARK_BATCH) {
      await models.Mark.bulkCreate(markRows);
      totalMarks += markRows.length;
      process.stdout.write(`\rMarks seeded: ${totalMarks}`);
      markRows = [];
    }
  }
  if (markRows.length) {
    await models.Mark.bulkCreate(markRows);
    totalMarks += markRows.length;
  }
  console.log(`\nMarks seeded: ${totalMarks}`);

  console.log(
    `\nDone. class_id=${klass.id} academic_year_id=${ACADEMIC_YEAR_ID} students=${studentIds.length}`
  );
  process.exit(0);
}

main().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
