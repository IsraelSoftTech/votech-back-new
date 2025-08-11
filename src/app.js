// const express = require("express");
// const cors = require("cors");
// const StatusCodes = require("http-status-codes").StatusCodes;
// const globalErrorController = require("./controllers/error.controller");

// const app = express();

// app.use((req, res, next) => {
//   res.header("Access-Control-Allow-Origin", "*");
//   res.header("Access-Control-Allow-Methods", "GET,HEAD,PUT,PATCH,POST,DELETE");
//   res.header(
//     "Access-Control-Allow-Headers",
//     "Origin, X-Requested-With, Content-Type, Accept"
//   );
//   next();
// });

// const corsOptions = {
//   credentials: true,
//   origin: [
//     "http://localhost:3000",
//     "http://localhost:8000",
//     "192.168.0.171",
//     "192.168.0.114",
//   ],
// };

// app.use(cors(corsOptions));

// app.use(express.static(__dirname + "/public"));
// app.use("*", (req, res, next) => {
//   next(
//     new AppError(
//       `${req.originalUrl} does not exist... for ${req.method} request`,
//       404
//     )
//   );
// });

// //Handling unexistent routes
// app.use("*", (req, res, next) => {
//   next(
//     new AppError(
//       `${req.originalUrl} does not exist... for ${req.method} request`,
//       StatusCodes.NOT_FOUND
//     )
//   );
// });

// //global error controllerr
// app.use(globalErrorController);

// module.exports = app;
