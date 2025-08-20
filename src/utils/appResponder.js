//The role of the app responder function is to send responses back, when the request is successfull
const appResponder = (statusCode, data, res) => {
  res.status(statusCode).json({ ok: true, status: "success", data });
};

module.exports = appResponder;
