const AppError = require("./AppError");
const statusCodes = require("http-status-codes").StatusCodes;
const jwt = require("jsonwebtoken");

const auth = (req, res, next) => {
  const authHeader = req.headers["authorization"];
  if (!authHeader) {
    return next(
      new AppError("No auth token, please log in", statusCodes.UNAUTHORIZED)
    );
  }

  const token = authHeader.split(" ")[1];
  if (!token) {
    return next(new AppError("No token provided", statusCodes.UNAUTHORIZED));
  }

  try {
    const JWT_SECRET = process.env.JWT_SECRET || "your-secret-key";
    const user = jwt.verify(token, JWT_SECRET);
    req.user = user;
    next();
  } catch (err) {
    if (err.name === "TokenExpiredError") {
      return next(new AppError("Token expired", statusCodes.UNAUTHORIZED));
    }
    return next(new AppError("Invalid token", statusCodes.FORBIDDEN));
  }
};

module.exports = auth;
