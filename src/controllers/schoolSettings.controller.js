"use strict";

const { StatusCodes } = require("http-status-codes");
const catchAsync = require("../utils/catchAsync");
const appResponder = require("../utils/appResponder");
const models = require("../models/index.model");

// Single-row settings, id is always 1 — created by the school_settings
// migration in index.js, so this should always exist, but findOrCreate
// keeps read requests safe even against a fresh DB that hasn't migrated
// yet (matches the defaults on the model/migration).
async function getOrCreateSettings() {
  const [row] = await models.SchoolSetting.findOrCreate({ where: { id: 1 } });
  return row;
}

const getSchoolSettings = catchAsync(async (req, res) => {
  const row = await getOrCreateSettings();
  appResponder(StatusCodes.OK, row, res);
});

const SETTINGS_WRITABLE_FIELDS = [
  "school_name",
  "principal_name",
  "contact_phone",
  "contact_email",
  "address",
  "motto",
];

const updateSchoolSettings = catchAsync(async (req, res) => {
  const row = await getOrCreateSettings();
  const data = {};
  for (const field of SETTINGS_WRITABLE_FIELDS) {
    if (field in req.body) data[field] = req.body[field];
  }
  await row.update(data);
  appResponder(StatusCodes.OK, row, res);
});

module.exports = {
  getSchoolSettings,
  updateSchoolSettings,
  // Reused directly by every PDF/document generator instead of each one
  // hardcoding the school name/principal separately.
  getOrCreateSettings,
};
