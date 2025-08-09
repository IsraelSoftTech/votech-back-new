const express = require("express");
const cors = require("cors");

const app = express();

app.use((req, res, next) => {
  res.header("Access-Control-Allow-Origin", "*");
  res.header("Access-Control-Allow-Methods", "GET,HEAD,PUT,PATCH,POST,DELETE");
  res.header(
    "Access-Control-Allow-Headers",
    "Origin, X-Requested-With, Content-Type, Accept"
  );
  next();
});

const corsOptions = {
  credentials: true,
  origin: [
    "http://localhost:3000",
    "http://localhost:8000",
    "192.168.0.171",
    "192.168.0.114",
  ],
};

app.use(cors(corsOptions));
