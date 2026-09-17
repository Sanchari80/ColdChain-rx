'use strict';

class AppError extends Error {
  constructor(status, code, message, details) {
    super(message);
    this.name = 'AppError';
    this.status = status;
    this.code = code;
    this.details = details;
    Error.captureStackTrace(this, AppError);
  }
}

const badRequest = (msg, details) => new AppError(400, 'bad_request', msg, details);
const unauthorized = (msg = 'Sign in to continue') => new AppError(401, 'unauthorized', msg);
const forbidden = (msg = 'This role cannot perform that action') => new AppError(403, 'forbidden', msg);
const notFound = (msg = 'Not found') => new AppError(404, 'not_found', msg);
const conflict = (msg, details) => new AppError(409, 'conflict', msg, details);
const upstream = (msg, details) => new AppError(502, 'upstream_error', msg, details);

module.exports = { AppError, badRequest, unauthorized, forbidden, notFound, conflict, upstream };
