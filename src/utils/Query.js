class Query {
  constructor(queryParams) {
    this.queryParams = queryParams;
    this.options = {};
  }

  // Build WHERE filters based on query params
  filter() {
    const filterObj = { ...this.queryParams };

    // Remove special keys for other features
    const specialKeys = ["fields", "sort", "page", "limit"];
    specialKeys.forEach((key) => delete filterObj[key]);

    // Sequelize expects operators like Op.gt, Op.gte etc. We will convert strings like gt, gte to Sequelize operators
    // For simplicity, support only flat filters like price[gt]=100
    // Sequelize operators must be imported from 'sequelize' Op
    const { Op } = require("sequelize");

    const where = {};

    Object.entries(filterObj).forEach(([key, value]) => {
      if (typeof value === "object") {
        // Example: { price: { gt: 100 } }
        where[key] = {};
        Object.entries(value).forEach(([opKey, opVal]) => {
          const operator = Op[opKey];
          if (operator) {
            where[key][operator] = opVal;
          }
        });
      } else {
        // simple equality
        where[key] = value;
      }
    });

    this.options.where = where;

    return this;
  }

  // Build ORDER clause
  sort(defaultSort) {
    if (this.queryParams.sort) {
      // support comma separated multiple sort fields, e.g. sort=field1,-field2
      const fields = this.queryParams.sort.split(",").map((field) => {
        if (field.startsWith("-")) {
          return [field.slice(1), "DESC"];
        } else {
          return [field, "ASC"];
        }
      });
      this.options.order = fields;
    } else if (defaultSort) {
      this.options.order = [[defaultSort, "ASC"]];
    }

    return this;
  }

  // Select specific attributes (fields)
  limitFields() {
    if (this.queryParams.fields) {
      const attributes = this.queryParams.fields.split(",");
      this.options.attributes = attributes;
    }
    return this;
  }

  // Pagination - calculate offset and limit
  paginate(defaultPage = 1, defaultLimit = 20) {
    const page = parseInt(this.queryParams.page, 10) || defaultPage;
    const limit = parseInt(this.queryParams.limit, 10) || defaultLimit;
    const offset = (page - 1) * limit;

    this.options.limit = limit;
    this.options.offset = offset;

    return this;
  }

  // Return the built options object
  getOptions() {
    return this.options;
  }
}

module.exports = Query;
