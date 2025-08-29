const AppError = require("./AppError");

//Sice must of the app opperations are asynchronous the catchAsync function with tack in any async function
//and catch any errors that are thrown or occur from a promise, this is so we done have to write try and
//catch blocks for every async operation

const catchAsync = (fn) => {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
};

module.exports = catchAsync;
