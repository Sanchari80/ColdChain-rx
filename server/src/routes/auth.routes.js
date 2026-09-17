'use strict';

const express = require('express');
const rateLimit = require('express-rate-limit');
const { z } = require('zod');
const validate = require('../middleware/validate');
const { login, loginWithSubject, authenticate } = require('../middleware/auth');
const asyncHandler = require('../util/asyncHandler');
const audit = require('../services/audit/auditService');
const directory = require('../services/identity/directory');
const sso = require('../services/identity/sso');
const config = require('../config');

const router = express.Router();

// Brute-force protection on every endpoint that accepts or completes a credential.
// Only failed attempts count: a ward shares one Wi-Fi address, and staff signing
// in correctly on shared devices must never lock each other out.
const loginLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  limit: config.auth.loginAttemptsPerWindow,
  skipSuccessfulRequests: true,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  skip: () => config.env === 'test',
  message: { error: { code: 'rate_limited', message: 'Too many incorrect sign-in attempts from this network. Wait a few minutes and try again.' } },
});

const loginSchema = z.object({
  staffId: z.string().trim().min(3).max(32),
  pin: z.string().trim().min(4).max(12),
});

const pinSchema = z.object({
  currentPin: z.string().trim().min(4).max(12),
  newPin: z.string().trim().min(4).max(12),
});

const ssoStartSchema = z.object({
  redirectUri: z.string().trim().url().max(500).optional(),
});

const ssoCompleteSchema = z.object({
  code: z.string().trim().min(4).max(2048),
  state: z.string().trim().min(8).max(256),
});

/**
 * How this facility lets people in.
 *
 * Open to the device before anyone has signed in, because the sign-in screen
 * has to know whether to offer single sign-on, and who to send someone to when
 * they have no account. It exposes no clinical data and no patient data.
 */
router.get('/methods', (req, res) => {
  res.json({
    facility: config.facility,
    support: config.support,
    credentials: {
      enabled: true,
      pinPolicy: {
        minLength: config.auth.pinMinLength,
        maxLength: config.auth.pinMaxLength,
        digitsOnly: true,
      },
      lockout: {
        attempts: config.auth.maxFailedAttempts,
        minutes: config.auth.lockoutMinutes,
      },
    },
    singleSignOn: sso.describe(),
    // Accounts exist only where hospital IT has created them. This service has
    // no registration endpoint and never creates one from a sign-in.
    selfRegistration: false,
    issuedAccess: directory.issuedAccess(),
  });
});

router.post('/login', loginLimiter, validate(loginSchema), asyncHandler(async (req, res) => {
  const { token, payload } = login(req.body.staffId, req.body.pin);
  await audit.record({
    action: 'E',
    subtypeCode: 'operation',
    subtypeDisplay: 'Staff signed in',
    actor: { id: payload.sub, role: payload.role, name: payload.name },
    sourceIp: req.ip,
    summary: `${payload.sub} signed in with a facility-issued credential`,
  });
  res.json({
    token,
    expiresAt: new Date(payload.exp * 1000).toISOString(),
    user: {
      id: payload.sub,
      name: payload.name,
      role: payload.role,
      title: payload.title,
      ward: payload.ward,
      department: payload.department,
      scopes: payload.scopes,
      method: payload.method,
      mustChangePin: payload.mustChangePin,
    },
  });
}));

/** Step one of single sign-on: where to send the device's browser. */
router.post('/sso/start', loginLimiter, validate(ssoStartSchema), asyncHandler(async (req, res) => {
  res.json(sso.begin({ redirectUri: req.body.redirectUri }));
}));

/**
 * Step two: the authorization code comes back and is exchanged server-side.
 * The person is then matched onto a provisioned directory entry, or refused.
 */
router.post('/sso/complete', loginLimiter, validate(ssoCompleteSchema), asyncHandler(async (req, res) => {
  const { subject } = await sso.complete({ code: req.body.code, state: req.body.state });
  const { token, payload } = loginWithSubject(subject);
  await audit.record({
    action: 'E',
    subtypeCode: 'operation',
    subtypeDisplay: 'Staff signed in',
    actor: { id: payload.sub, role: payload.role, name: payload.name },
    sourceIp: req.ip,
    summary: `${payload.sub} signed in through ${config.sso.displayName}`,
  });
  res.json({
    token,
    expiresAt: new Date(payload.exp * 1000).toISOString(),
    user: {
      id: payload.sub,
      name: payload.name,
      role: payload.role,
      title: payload.title,
      ward: payload.ward,
      department: payload.department,
      scopes: payload.scopes,
      method: payload.method,
      mustChangePin: false,
    },
  });
}));

router.get('/me', authenticate, (req, res) => {
  res.json({ user: req.actor, account: directory.publicRecord(directory.get(req.actor.id)) });
});

/** The account holder replaces the PIN hospital IT issued with their own. */
router.post('/pin', authenticate, validate(pinSchema), asyncHandler(async (req, res) => {
  const account = directory.changePin(req.actor.id, req.body.currentPin, req.body.newPin);
  await audit.record({
    action: 'U',
    subtypeCode: 'update',
    subtypeDisplay: 'Credential changed',
    actor: { id: req.actor.id, role: req.actor.role, name: req.actor.name },
    sourceIp: req.ip,
    summary: `${req.actor.id} changed their own PIN`,
  });
  res.json({ account });
}));

module.exports = router;
