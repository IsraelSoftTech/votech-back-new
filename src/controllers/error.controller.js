const statusCodes = require("http-status-codes").StatusCodes;

//resDev handles sending error responses when the app is still in development
const resDev = (err, res) => {
  res.status(err.statusCode).json({
    ok: false,
    status: err.status,
    message: err.message,
    error: err,
    stack: err.stack,
  });
};

//resProd handles sending errors when app is in production
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
      status: "Sever error",
      message: "Something went very wrong..., don't fret it not your fault",
    });
  }
};

//The application global error constoller
const globalErrorController = (err, req, res, next) => {
  err.statusCode = err.statusCode || 500;
  err.status = err.status || "Sever error";

  if (process.env.NODE_ENV === "production") {
    resProd(err, res);
  } else if (process.env.NODE_ENV === "development") {
    resDev(err, res);
  }
};

module.exports = globalErrorController;
