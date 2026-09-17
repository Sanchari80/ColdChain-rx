'use strict';

const config = require('../config');

const LEVELS = { silent: 0, error: 1, warn: 2, info: 3, debug: 4 };
const active = LEVELS[config.logLevel] ?? LEVELS.info;

// Field names that must never reach a log line. Logs are the most common place
// PHI leaks out of a hospital system, so redaction happens at the sink.
const REDACT = new Set([
  'name', 'given', 'family', 'birthDate', 'dob', 'phone', 'telecom', 'address',
  'mrn', 'ssn', 'email', 'patientName', 'authorization', 'token', 'password',
]);

function scrub(value, depth = 0) {
  if (depth > 6 || value === null || value === undefined) return value;
  if (Array.isArray(value)) return value.map((v) => scrub(v, depth + 1));
  if (typeof value !== 'object') return value;
  const out = {};
  for (const [k, v] of Object.entries(value)) {
    out[k] = REDACT.has(k) ? '[redacted]' : scrub(v, depth + 1);
  }
  return out;
}

function emit(level, message, meta) {
  if (LEVELS[level] > active) return;
  const line = {
    ts: new Date().toISOString(),
    level,
    msg: message,
  };
  if (meta !== undefined) line.meta = scrub(meta);
  const text = JSON.stringify(line);
  if (level === 'error') process.stderr.write(`${text}\n`);
  else process.stdout.write(`${text}\n`);
}

module.exports = {
  error: (m, meta) => emit('error', m, meta),
  warn: (m, meta) => emit('warn', m, meta),
  info: (m, meta) => emit('info', m, meta),
  debug: (m, meta) => emit('debug', m, meta),
  scrub,
};
