"use strict";

const { AsyncLocalStorage } = require("async_hooks");

// Carries "who is making this request" through the entire async call
// chain of a request, so code far from the route handler (model hooks,
// in particular) can ask "who is this" without it being threaded through
// every function signature by hand. Established once, right after auth,
// on routes that opt in (see attachRequestContext below) — nothing
// outside those routes is affected.
const als = new AsyncLocalStorage();

function attachRequestContext(req, res, next) {
  const store = {
    userId: req.user?.id ?? null,
    role: req.user?.role ?? null,
  };
  als.run(store, () => next());
}

function getRequestContext() {
  return als.getStore() || null;
}

module.exports = { attachRequestContext, getRequestContext };
