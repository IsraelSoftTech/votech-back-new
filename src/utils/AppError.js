// The role of the AppError Class is to have custom errors, that provide us information that the built error
//class will not e.g the status, statusCode, and whether the error is operational or not
class AppError extends Error {
  constructor(message, statusCode) {
    // Handling duplicate key errors

    if (message.startsWith("E11000")) {
      const split = message.split(" ");

      split.forEach((word, index) => {
        if (word === "{") {
          const prop = `${split[index + 1]}`.split("");
          prop.pop();

          message = `Duplicate key error: You are attempting to create a resource(s) with a property of ${prop.join(
            ""
          )} that is not unique try changing the value of ${prop.join("")}!`;
        }
      });
    }

    if (message.startsWith("Cast")) {
      message = "Request contains one or more invalid resource Id's";
    }

    super(message);

    this.statusCode = statusCode;
    this.status = `${statusCode}`.startsWith("4") ? "failed" : "server error";
    this.isOperational = true;

    Error.captureStackTrace(this, this.constructor);
  }
}

module.exports = AppError;
