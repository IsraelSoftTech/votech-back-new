const { StatusCodes } = require("http-status-codes");
const models = require("../models/index.model");
const AppError = require("../utils/AppError");
const catchAsync = require("../utils/catchAsync");
const CRUD = require("../utils/Crud");
const appResponder = require("../utils/appResponder");

const AcademicBandModel = models.academic_bands;
const tableName = AcademicBandModel.getTableName();

let CRUDAcademicBand = new CRUD(models.academic_bands);

async function initAcademicBand() {
  try {
    const tables = await AcademicBandModel.sequelize
      .getQueryInterface()
      .showAllTables();
    if (!tables.includes(tableName)) {
      await AcademicBandModel.sync({ force: false });
    }
    CRUDAcademicBand = new CRUD(models.academic_bands);
  } catch (err) {
    throw err;
  }
}

initAcademicBand();

/**
 * Application-level validation for AcademicBand
 * Ensures:
 * - band_min and band_max are integers >= 0
 * - band_max >= band_min
 * - Comment exists
 * - academic_year_id and class_id are positive integers
 */
async function validateAcademicBandData(data, partial = false) {
  const errors = [];

  if (data.comment && typeof data.comment === "string") {
    data.comment = data.comment.trim();
  }

  if (!partial || "band_min" in data) {
    if (
      data.band_min === undefined ||
      !Number.isInteger(data.band_min) ||
      data.band_min < 0 ||
      data.band_min > 20
    ) {
      errors.push("Minimum band must be an integer between 0 and 20");
    }
  }

  if (!partial || "band_max" in data) {
    if (
      data.band_max === undefined ||
      !Number.isInteger(data.band_max) ||
      data.band_max < 0 ||
      data.band_max > 20
    ) {
      errors.push("Maximum band must be an integer between 0 and 20");
    }
  }

  if (
    (!partial || ("band_min" in data && "band_max" in data)) &&
    data.band_min !== undefined &&
    data.band_max !== undefined &&
    data.band_max < data.band_min
  ) {
    errors.push("Maximum band must be greater than or equal to minimum band");
  }

  if (!partial || "comment" in data) {
    if (
      !data.comment ||
      typeof data.comment !== "string" ||
      data.comment.length < 2
    ) {
      errors.push("Comment is required and must be at least 2 characters");
    }
  }

  if (!partial || "academic_year_id" in data) {
    if (
      !Number.isInteger(data.academic_year_id) ||
      data.academic_year_id <= 0
    ) {
      errors.push("academic_year_id must be a positive integer");
    }
  }

  if (!partial || "class_id" in data) {
    if (!Number.isInteger(data.class_id) || data.class_id <= 0) {
      errors.push("class_id must be a positive integer");
    }
  }

  if (errors.length > 0) {
    throw new AppError(errors.join("; "), StatusCodes.BAD_REQUEST);
  }
}

// Eager loading relationships
const include = [
  { association: AcademicBandModel.associations.academic_year },
  {
    association: AcademicBandModel.associations.class,
    include: [{ association: models.Class.associations.department }],
  },
];

// Controller methods
const createAcademicBand = catchAsync(async (req, res, next) => {
  await validateAcademicBandData(req.body);
  await CRUDAcademicBand.create(req.body, res);
});

const readOneAcademicBand = catchAsync(async (req, res, next) => {
  await CRUDAcademicBand.readOne(req.params.id, res, include);
});

const readAllAcademicBands = catchAsync(async (req, res, next) => {
  await CRUDAcademicBand.readAll(res, req, "", 1, 100, include);
});

const updateAcademicBand = catchAsync(async (req, res, next) => {
  await validateAcademicBandData(req.body, true);
  await CRUDAcademicBand.update(req.params.id, res, req);
});

const deleteAcademicBand = catchAsync(async (req, res, next) => {
  await CRUDAcademicBand.delete(req.params.id, res);
});

const saveAcademicBandsBatch = catchAsync(async (req, res, next) => {
  const { academic_year_id, class_id, bands } = req.body;

  if (
    !academic_year_id ||
    !class_id ||
    !Array.isArray(bands) ||
    bands.length === 0
  ) {
    return next(
      new AppError(
        "academic_year_id, class_id, and bands are required",
        StatusCodes.BAD_REQUEST
      )
    );
  }

  // Validate each band individually
  for (const b of bands) {
    await validateAcademicBandData({ ...b, academic_year_id, class_id });
  }

  // Check overlaps within the request body
  const sortedBands = [...bands].sort((a, b) => a.band_min - b.band_min);
  for (let i = 1; i < sortedBands.length; i++) {
    const prev = sortedBands[i - 1];
    const curr = sortedBands[i];
    if (curr.band_min <= prev.band_max) {
      return next(
        new AppError(
          `Overlap in request body: band ${curr.band_min}–${curr.band_max} overlaps with ${prev.band_min}–${prev.band_max}`,
          StatusCodes.BAD_REQUEST
        )
      );
    }
  }

  // Transaction ensures atomicity
  const transaction = await AcademicBandModel.sequelize.transaction();
  try {
    // Delete old bands for this year + class
    await AcademicBandModel.destroy({
      where: { academic_year_id, class_id },
      transaction,
    });

    // Insert new bands
    const bandsToInsert = bands.map((b) => ({
      ...b,
      academic_year_id,
      class_id,
    }));
    await AcademicBandModel.bulkCreate(bandsToInsert, { transaction });

    await transaction.commit();

    return appResponder(
      StatusCodes.OK,
      { status: "success", message: "Academic bands saved successfully" },
      res
    );
  } catch (err) {
    await transaction.rollback();
    next(err);
  }
});

module.exports = {
  initAcademicBand,
  createAcademicBand,
  readOneAcademicBand,
  readAllAcademicBands,
  updateAcademicBand,
  deleteAcademicBand,
  validateAcademicBandData,
  saveAcademicBandsBatch,
};
