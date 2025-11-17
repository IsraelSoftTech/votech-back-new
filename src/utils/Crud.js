const statusCodes = require("http-status-codes").StatusCodes;
const appResponder = require("./appResponder");
const AppError = require("./AppError");
const Query = require("./Query");
const { ChangeTypes, logChanges } = require("./logChanges.util");

class CRUD {
  constructor(model) {
    this.model = model;
  }

  // Create a new record
  async create(body, res, req) {
    const data = await this.model.create(body);

    await logChanges(
      this.model.tableName,
      data.id,
      ChangeTypes.create,
      req.user
    );
    appResponder(statusCodes.CREATED, data, res);
  }

  // Read one by primary key, with optional includes (associations)
  async readOne(id, res, include) {
    const data = await this.model.findByPk(id, { include });

    if (!data) {
      throw new AppError("Invalid id, no such resource in the database", 404);
    }

    appResponder(statusCodes.OK, data, res);
  }

  // Read all with query options like filters, pagination, sorting
  async readAll(res, req, defaultSort, defaultPage, defaultLimit, include) {
    // Use Query helper to build options object for Sequelize
    let options = new Query(req.query)
      .filter()
      .sort(defaultSort)
      .limitFields() // optional, keep if you want to select specific fields
      .paginate(defaultPage, defaultLimit)
      .getOptions();

    if (include) {
      options.include = include;
    }

    const data = await this.model.findAll(options);

    appResponder(statusCodes.OK, data, res);
  }

  async update(id, res, req) {
    const existing = await this.model.findByPk(id);
    if (!existing) {
      throw new AppError("Invalid Id, no such resource in the database", 404);
    }
    const existingPlain = existing.get({ plain: true });

    const fieldsChanged = {};
    for (const key in req.body) {
      const newVal = req.body[key];
      const oldVal = existingPlain[key];

      if (String(newVal) !== String(oldVal)) {
        fieldsChanged[key] = { before: oldVal, after: newVal };
      }
    }

    const [updatedCount] = await this.model.update(req.body, { where: { id } });

    if (updatedCount === 0) {
      throw new AppError("Failed to update record", 500);
    }

    const data = await this.model.findByPk(id);

    if (Object.keys(fieldsChanged).length > 0) {
      await logChanges(
        this.model.tableName,
        id,
        ChangeTypes.update,
        req.user,
        fieldsChanged
      );
    }

    appResponder(statusCodes.OK, data, res);
  }

  async delete(id, res, req) {
    const existing = await this.model.findByPk(id);
    if (!existing) {
      throw new AppError("Invalid Id, no such resource in the database", 404);
    }

    const existingPlain = existing.get({ plain: true });

    const deletedCount = await this.model.destroy({ where: { id } });
    if (deletedCount === 0) {
      throw new AppError("Invalid Id, no such resource in the database", 404);
    }

    const fieldsChanged = {};
    for (const key in existingPlain) {
      fieldsChanged[key] = { before: existingPlain[key] };
    }

    await logChanges(
      this.model.tableName,
      id,
      ChangeTypes.delete,
      req.user,
      fieldsChanged
    );

    appResponder(
      statusCodes.OK,
      { message: "Resource deleted successfully" },
      res
    );
  }
}

module.exports = CRUD;
