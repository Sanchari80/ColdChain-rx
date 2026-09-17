'use strict';

const { badRequest } = require('../util/errors');

/** Validates req[source] with a zod schema and replaces it with the parsed value. */
module.exports = function validate(schema, source = 'body') {
  return function run(req, res, next) {
    const result = schema.safeParse(req[source]);
    if (!result.success) {
      const details = result.error.issues.map((issue) => ({
        field: issue.path.join('.') || source,
        message: issue.message,
      }));
      return next(badRequest('Some fields need fixing', details));
    }
    if (source === 'query') req.validatedQuery = result.data;
    else req[source] = result.data;
    return next();
  };
};
