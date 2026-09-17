'use strict';

const config = require('../config');
const logger = require('../util/logger');
const { PhiLeakError } = require('../services/phi/deidentify');

function notFoundHandler(req, res) {
  res.status(404).json({
    error: { code: 'not_found', message: `No route matches ${req.method} ${req.originalUrl}` },
    requestId: req.id,
  });
}

// eslint-disable-next-line no-unused-vars -- Express identifies error handlers by arity
function errorHandler(err, req, res, next) {
  const status = err.status || 500;
  const code = err.code || (status === 500 ? 'internal_error' : 'error');

  if (err instanceof PhiLeakError) {
    logger.error('phi.leak.blocked', { requestId: req.id, findings: err.findings });
  } else if (status >= 500) {
    logger.error('request.failed', { requestId: req.id, code, message: err.message, stack: config.isProd ? undefined : err.stack });
  } else {
    logger.warn('request.rejected', { requestId: req.id, code, message: err.message });
  }

  res.status(status).json({
    error: {
      code,
      // A 500's internal message can carry implementation detail; never ship it.
      message: status >= 500 && config.isProd ? 'Something went wrong on the server' : err.message,
      details: err.details || err.findings || undefined,
    },
    requestId: req.id,
  });
}

module.exports = { errorHandler, notFoundHandler };
