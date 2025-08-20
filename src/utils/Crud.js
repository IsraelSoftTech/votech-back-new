const statusCodes = require("http-status-codes").StatusCodes;
const appResponder = require("./appResponder");
const AppError = require("./AppError");
const Query = require("./Query");

class CRUD {
  constructor(model) {
    this.model = model;
  }

  // Create a new record
  async create(body, res) {
    const data = await this.model.create(body);
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

  // Update record by id
  async update(id, res, req) {
    const [updatedCount] = await this.model.update(req.body, {
      where: { id },
    });

    if (updatedCount === 0) {
      throw new AppError("Invalid Id, no such resource in the database", 404);
    }

    const data = await this.model.findByPk(id);

    appResponder(statusCodes.OK, data, res);
  }

  // Delete record by id
  async delete(id, res) {
    const deletedCount = await this.model.destroy({ where: { id } });

    if (deletedCount === 0) {
      throw new AppError("Invalid Id, no such resource in the database", 404);
    }

    appResponder(
      statusCodes.OK,
      { message: "Resource deleted successfully" },
      res
    );
  }
}

module.exports = CRUD;
