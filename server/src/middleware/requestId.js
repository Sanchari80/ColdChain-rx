'use strict';

const { randomUUID } = require('node:crypto');

module.exports = function requestId(req, res, next) {
  req.id = req.get('x-request-id') || randomUUID();
  res.setHeader('X-Request-Id', req.id);
  next();
};
