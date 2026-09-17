'use strict';

const { createHmac, timingSafeEqual } = require('node:crypto');
const config = require('../config');
const directory = require('../services/identity/directory');
const { unauthorized, forbidden } = require('../util/errors');

/**
 * Sessions and role-based access control.
 *
 * Two things authenticate a person, and neither of them can create an account:
 *
 *   1. A facility-issued credential (staff ID + PIN) checked against the staff
 *      directory that hospital IT provisions.
 *   2. The facility's own identity provider, over OpenID Connect, where the
 *      subject claim must already be attached to a provisioned directory entry.
 *
 * Either way this service issues the session token, because the session carries
 * the role and the scopes that every route guards on. The token is signed,
 * short lived, and never stores anything the client could edit into a wider
 * permission: the role claim is read from the directory, never from the client.
 */

function base64url(input) {
  return Buffer.from(input).toString('base64url');
}

function sign(payloadJson) {
  return createHmac('sha256', config.auth.secret).update(payloadJson).digest('base64url');
}

function issueToken(account, { method = 'credential' } = {}) {
  const payload = {
    sub: account.id,
    name: account.name,
    role: account.role,
    title: account.title || null,
    ward: account.ward || null,
    department: account.department || null,
    practitionerId: account.practitionerId || null,
    scopes: directory.scopesFor(account.role),
    method,
    mustChangePin: Boolean(account.mustChangePin),
    iat: Math.floor(Date.now() / 1000),
    exp: Math.floor(Date.now() / 1000) + config.auth.ttlSeconds,
  };
  const body = JSON.stringify(payload);
  return { token: `${base64url(body)}.${sign(body)}`, payload };
}

function verifyToken(token) {
  if (typeof token !== 'string' || !token.includes('.')) throw unauthorized('Malformed session token');
  const [body, signature] = token.split('.');
  let json;
  try {
    json = Buffer.from(body, 'base64url').toString('utf8');
  } catch {
    throw unauthorized('Malformed session token');
  }

  const expected = Buffer.from(sign(json));
  const received = Buffer.from(String(signature));
  if (expected.length !== received.length || !timingSafeEqual(expected, received)) {
    throw unauthorized('Session token signature does not verify');
  }

  const payload = JSON.parse(json);
  if (payload.exp * 1000 < Date.now()) throw unauthorized('Your session has ended. Sign in again.');
  return payload;
}

/** Signs in with a facility-issued staff ID and PIN. */
function login(staffId, pin) {
  const account = directory.authenticate(staffId, pin);
  return issueToken(account, { method: 'credential' });
}

/** Signs in a person the facility's identity provider has just authenticated. */
function loginWithSubject(subject) {
  const account = directory.authenticateBySubject(subject);
  return issueToken(account, { method: 'sso' });
}

function sessionUser(payload) {
  return {
    id: payload.sub,
    name: payload.name,
    role: payload.role,
    title: payload.title || null,
    ward: payload.ward || null,
    department: payload.department || null,
    practitionerId: payload.practitionerId || null,
    scopes: payload.scopes || [],
    method: payload.method || 'credential',
    mustChangePin: Boolean(payload.mustChangePin),
  };
}

function authenticate(req, res, next) {
  const header = req.get('authorization') || '';
  const [scheme, token] = header.split(' ');
  if (!scheme || scheme.toLowerCase() !== 'bearer' || !token) {
    return next(unauthorized('Send an Authorization: Bearer <token> header'));
  }
  try {
    const payload = verifyToken(token);
    const account = directory.find(payload.sub);
    // An account suspended mid-shift loses access on its next request rather
    // than when its token happens to expire.
    if (account && account.status !== 'active') {
      return next(forbidden('This account has been suspended. Contact the hospital IT service desk.'));
    }
    req.actor = sessionUser(payload);
    return next();
  } catch (err) {
    return next(err);
  }
}

function requireScope(scope) {
  return function guard(req, res, next) {
    if (!req.actor) return next(unauthorized());
    if (!req.actor.scopes.includes(scope)) {
      const role = req.actor.title || req.actor.role;
      return next(forbidden(`${role} accounts are not permitted to do that`));
    }
    return next();
  };
}

module.exports = {
  authenticate,
  requireScope,
  login,
  loginWithSubject,
  issueToken,
  verifyToken,
  sessionUser,
};
