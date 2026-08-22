const { StatusCodes } = require("http-status-codes");
const models = require("../models/index.model");
const AppError = require("../utils/AppError");
const catchAsync = require("../utils/catchAsync");
const CRUD = require("../utils/Crud");
const appResponder = require("../utils/appResponder");
const { ChangeTypes, logChanges } = require("../utils/logChanges.util");

const PromotionRequirementModel = models.PromotionRequirement;
const tableName = PromotionRequirementModel.getTableName();

let CRUDPromotionRequirement = new CRUD(models.PromotionRequirement);

async function initPromotionRequirement() {
  try {
    const tables = await PromotionRequirementModel.sequelize
      .getQueryInterface()
      .showAllTables();
    if (!tables.includes(tableName)) {
      await PromotionRequirementModel.sync({ force: false });
    }
    CRUDPromotionRequirement = new CRUD(models.PromotionRequirement);
  } catch (err) {
    throw err;
  }
}

initPromotionRequirement();

/**
 * Application-level validation for PromotionRequirement.
 * Ensures numeric fields are sane and that every subject id named as
 * "compulsory" actually belongs to this class's curriculum (class_subjects)
 * and is tagged with the matching category (general / professional).
 */
async function validatePromotionRequirementData(data, partial = false) {
  const errors = [];

  if (!partial || "academic_year_id" in data) {
    if (!Number.isInteger(data.academic_year_id) || data.academic_year_id <= 0) {
      errors.push("academic_year_id must be a positive integer");
    }
  }

  if (!partial || "class_id" in data) {
    if (!Number.isInteger(data.class_id) || data.class_id <= 0) {
      errors.push("class_id must be a positive integer");
    }
  }

  if (!partial || "min_average" in data) {
    if (
      typeof data.min_average !== "number" ||
      data.min_average < 0 ||
      data.min_average > 20
    ) {
      errors.push("Minimum promotion average must be a number between 0 and 20");
    }
  }

  if (!partial || "pass_mark" in data) {
    if (
      data.pass_mark !== undefined &&
      (typeof data.pass_mark !== "number" || data.pass_mark < 0 || data.pass_mark > 20)
    ) {
      errors.push("Pass mark must be a number between 0 and 20");
    }
  }

  if (!partial || "min_professional_subjects_passed" in data) {
    if (
      !Number.isInteger(data.min_professional_subjects_passed) ||
      data.min_professional_subjects_passed < 0
    ) {
      errors.push(
        "Minimum number of professional subjects passed must be a non-negative integer"
      );
    }
  }

  const generalIds = Array.isArray(data.compulsory_general_subject_ids)
    ? data.compulsory_general_subject_ids
    : [];
  const professionalIds = Array.isArray(data.compulsory_professional_subject_ids)
    ? data.compulsory_professional_subject_ids
    : [];

  for (const [label, ids] of [
    ["compulsory_general_subject_ids", generalIds],
    ["compulsory_professional_subject_ids", professionalIds],
  ]) {
    if (label in data && !Array.isArray(data[label])) {
      errors.push(`${label} must be an array of subject ids`);
    } else if (ids.some((id) => !Number.isInteger(id) || id <= 0)) {
      errors.push(`${label} must only contain positive integer subject ids`);
    }
  }

  if (errors.length > 0) {
    throw new AppError(errors.join("; "), StatusCodes.BAD_REQUEST);
  }

  // Cross-check compulsory subjects, and the min-professional-count field,
  // against this class's actual curriculum.
  if (data.class_id) {
    const classSubjects = await models.ClassSubject.findAll({
      where: { class_id: data.class_id },
      include: [{ association: models.ClassSubject.associations.subject }],
    });

    const taughtByCategory = { general: new Set(), professional: new Set() };
    for (const cs of classSubjects) {
      const category = cs.subject?.category;
      if (category === "general" || category === "professional") {
        taughtByCategory[category].add(cs.subject_id);
      }
    }

    const invalidGeneral = generalIds.filter(
      (id) => !taughtByCategory.general.has(id)
    );
    const invalidProfessional = professionalIds.filter(
      (id) => !taughtByCategory.professional.has(id)
    );

    if (invalidGeneral.length) {
      errors.push(
        `Subject id(s) ${invalidGeneral.join(
          ", "
        )} are not General subjects taught in this class`
      );
    }
    if (invalidProfessional.length) {
      errors.push(
        `Subject id(s) ${invalidProfessional.join(
          ", "
        )} are not Professional subjects taught in this class`
      );
    }

    if (
      (!partial || "min_professional_subjects_passed" in data) &&
      Number.isInteger(data.min_professional_subjects_passed) &&
      data.min_professional_subjects_passed > taughtByCategory.professional.size
    ) {
      errors.push(
        `Minimum professional subjects passed (${data.min_professional_subjects_passed}) cannot exceed the ${taughtByCategory.professional.size} Professional subject(s) actually taught in this class`
      );
    }

    if (errors.length > 0) {
      throw new AppError(errors.join("; "), StatusCodes.BAD_REQUEST);
    }
  }
}

const include = [
  { association: PromotionRequirementModel.associations.academic_year },
  {
    association: PromotionRequirementModel.associations.class,
    include: [{ association: models.Class.associations.department }],
  },
];

const readAllPromotionRequirements = catchAsync(async (req, res, next) => {
  await CRUDPromotionRequirement.readAll(res, req, "", 1, 500, include);
});

const readOnePromotionRequirement = catchAsync(async (req, res, next) => {
  await CRUDPromotionRequirement.readOne(req.params.id, res, include);
});

const deletePromotionRequirement = catchAsync(async (req, res, next) => {
  await CRUDPromotionRequirement.delete(req.params.id, res, req);
});

// Upsert: one settings row per (academic_year_id, class_id). Admin edits the
// same row repeatedly rather than accumulating a history of rows (unlike
// academic bands, this isn't a list of ranges, it's a single config object).
const savePromotionRequirement = catchAsync(async (req, res, next) => {
  const {
    academic_year_id,
    class_id,
    min_average,
    pass_mark,
    compulsory_general_subject_ids,
    compulsory_professional_subject_ids,
    min_professional_subjects_passed,
  } = req.body;

  const payload = {
    academic_year_id,
    class_id,
    min_average,
    pass_mark: pass_mark === undefined ? 10 : pass_mark,
    compulsory_general_subject_ids: compulsory_general_subject_ids || [],
    compulsory_professional_subject_ids: compulsory_professional_subject_ids || [],
    min_professional_subjects_passed: min_professional_subjects_passed || 0,
  };

  await validatePromotionRequirementData(payload);

  const transaction = await PromotionRequirementModel.sequelize.transaction();
  try {
    const existing = await PromotionRequirementModel.findOne({
      where: { academic_year_id, class_id },
      transaction,
    });

    let record;
    if (existing) {
      const before = existing.get({ plain: true });
      await existing.update(payload, { transaction });
      record = existing;

      const fieldsChanged = {};
      for (const key of Object.keys(payload)) {
        if (String(before[key]) !== String(payload[key])) {
          fieldsChanged[key] = { before: before[key], after: payload[key] };
        }
      }
      if (Object.keys(fieldsChanged).length > 0) {
        await logChanges(
          PromotionRequirementModel.tableName,
          record.id,
          ChangeTypes.update,
          req.user,
          fieldsChanged
        );
      }
    } else {
      record = await PromotionRequirementModel.create(payload, { transaction });

      const fieldsChanged = {};
      for (const key of Object.keys(payload)) {
        fieldsChanged[key] = { after: payload[key] };
      }
      await logChanges(
        PromotionRequirementModel.tableName,
        record.id,
        ChangeTypes.create,
        req.user,
        fieldsChanged
      );
    }

    await transaction.commit();

    return appResponder(
      StatusCodes.OK,
      { status: "success", message: "Promotion requirements saved successfully", data: record },
      res
    );
  } catch (err) {
    await transaction.rollback();
    next(err);
  }
});

module.exports = {
  initPromotionRequirement,
  readAllPromotionRequirements,
  readOnePromotionRequirement,
  deletePromotionRequirement,
  savePromotionRequirement,
  validatePromotionRequirementData,
};
