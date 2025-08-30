const { StatusCodes } = require("http-status-codes");
const catchAsync = require("../utils/catchAsync");
const AppError = require("../utils/AppError");
const jwt = require("jsonwebtoken");
const { promisify } = require("util");

const { sequelize } = require("../db");

const protect = catchAsync(async (req, res, next) => {
  let token;

  if (
    req.headers.authorization &&
    req.headers.authorization.startsWith("Bearer ")
  ) {
    token = req.headers.authorization.split(" ")[1];
  }

  if (!token) {
    throw new AppError(
      "Invalid auth token, please login to access this resource",
      StatusCodes.UNAUTHORIZED
    );
  }



  const decodedToken = await promisify(jwt.verify)(
    token,
    process.env.JWT_SECRET
  );

  // Raw SQL query to fetch user by id
  const [results] = await sequelize.query(
    "SELECT * FROM public.users WHERE id = :id LIMIT 1",
    {
      replacements: { id: decodedToken.id },
      type: sequelize.QueryTypes.SELECT,
    }
  );

  const user = results; // result is already plain object due to QueryTypes.SELECT

  if (!user) {
    throw new AppError(
      "This user no longer exists in the database",
      StatusCodes.NOT_FOUND
    );
  }

  if (
    user.passwordChangedAt &&
    new Date(user.passwordChangedAt).getTime() / 1000 > decodedToken.iat
  ) {
    throw new AppError(
      "User password was changed! Please login again to access this resource",
      StatusCodes.UNAUTHORIZED
    );
  }

  req.user = { ...user, role: decodedToken.role };

  next();
});

const restrictTo = (...roles) => {
  return catchAsync(async (req, res, next) => {
    if (!req.user) {
      throw new AppError(
        "No user info found on request",
        StatusCodes.UNAUTHORIZED
      );
    }

    if (!roles.includes(req.user.role)) {
      throw new AppError("Unauthorized Request", StatusCodes.FORBIDDEN);
    }

    next();
  });
};

module.exports = {
  restrictTo,
  protect,
};
