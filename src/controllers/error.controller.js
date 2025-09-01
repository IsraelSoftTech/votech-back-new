const statusCodes = require("http-status-codes").StatusCodes;

// Handle errors in development
const resDev = (err, res) => {
  res.status(err.statusCode).json({
    ok: false,
    status: err.status,
    message: err.message,
    error: err,
    stack: err.stack,
  });
};

// Handle errors in production
const resProd = (err, res) => {
  if (err.isOperational) {
    res.status(err.statusCode).json({
      ok: false,
      status: err.status,
      message: err.message,
    });
  } else {
    res.status(statusCodes.INTERNAL_SERVER_ERROR).json({
      ok: false,
      status: "Server error",
      message: "Something went very wrong... Don’t fret, it’s not your fault.",
    });
  }
};

// Global error controller
const globalErrorController = (err, req, res, next) => {
  err.statusCode = err.statusCode || 500;
  err.status = err.status || "Server error";

  if (process.env.NODE_ENV === "development") {
    resDev(err, res);
  } else {
    resProd(err, res);
  }

  console.error("ERROR 💥:", err);
};

module.exports = globalErrorController;
