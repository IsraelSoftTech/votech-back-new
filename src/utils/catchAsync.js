const AppError = require("./AppError");

//Sice must of the app opperations are asynchronous the catchAsync function with tack in any async function
//and catch any errors that are thrown or occur from a promise, this is so we done have to write try and
//catch blocks for every async operation

const catchAsync = (func) => {
  return (req, res, next) => {
    func(req, res, next).catch((err) => {
      console.log(err);
      next(new AppError(err.message, err.statusCode));
    });
  };
};

module.exports = catchAsync;
