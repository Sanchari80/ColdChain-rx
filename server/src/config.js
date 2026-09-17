'use strict';

require('dotenv').config();

/**
 * Central configuration.
 *
 * DATA_MODE controls where clinical data comes from:
 *   - "mock" (default): the service's own in-memory FHIR R4 store plus the
 *     bundled formulary snapshot. Nothing leaves the machine.
 *   - "live": talks to the facility's FHIR server and to the NIH/NLM RxNav API.
 *
 * Never point "live" at a production EHR without a signed BAA.
 */

function bool(value, fallback) {
  if (value === undefined || value === '') return fallback;
  return String(value).toLowerCase() === 'true' || value === '1';
}

function int(value, fallback) {
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) ? n : fallback;
}

function list(value, fallback = []) {
  if (!value) return fallback;
  return String(value).split(',').map((item) => item.trim()).filter(Boolean);
}

const NODE_ENV = process.env.NODE_ENV || 'development';

const config = {
  env: NODE_ENV,
  isProd: NODE_ENV === 'production',
  port: int(process.env.PORT, 4000),
  host: process.env.HOST || '0.0.0.0',
  // Folder holding the exported web app, relative to the server folder.
  webDist: process.env.WEB_DIST || '../mobile/dist',

  dataMode: (process.env.DATA_MODE || 'mock').toLowerCase(),

  facility: {
    name: process.env.FACILITY_NAME || 'Metropolitan General Hospital',
    code: process.env.FACILITY_CODE || 'MGH',
    pharmacy: process.env.PHARMACY_NAME || 'Inpatient Pharmacy, Level 2',
  },

  support: {
    desk: process.env.SUPPORT_DESK || 'Hospital IT service desk',
    phone: process.env.SUPPORT_PHONE || 'Extension 2470',
    email: process.env.SUPPORT_EMAIL || 'servicedesk@mgh.example',
    hours: process.env.SUPPORT_HOURS || 'Staffed 24 hours',
  },

  fhir: {
    baseUrl: (process.env.FHIR_BASE_URL || 'https://hapi.fhir.org/baseR4').replace(/\/+$/, ''),
    token: process.env.FHIR_TOKEN || null,
    timeoutMs: int(process.env.FHIR_TIMEOUT_MS, 12000),
  },

  rxnorm: {
    baseUrl: (process.env.RXNAV_BASE_URL || 'https://rxnav.nlm.nih.gov/REST').replace(/\/+$/, ''),
    timeoutMs: int(process.env.RXNAV_TIMEOUT_MS, 10000),
    // RxNav is public and unauthenticated but rate limited to ~20 req/s/IP.
    minIntervalMs: int(process.env.RXNAV_MIN_INTERVAL_MS, 60),
  },

  auth: {
    // Signing secret for the session token this service issues to accounts that
    // sign in with facility-issued credentials. When the facility runs single
    // sign-on, the identity provider authenticates the person and this service
    // still issues the session that carries the role and the scopes.
    secret: process.env.AUTH_SECRET || 'coldchain-dev-secret-change-me',
    ttlSeconds: int(process.env.AUTH_TTL_SECONDS, 60 * 60 * 8),
    loginAttemptsPerWindow: int(process.env.AUTH_LOGIN_ATTEMPTS, 30),
    // An account locks itself after this many wrong PINs and stays locked for
    // the lockout window, so a stolen staff ID cannot be brute forced.
    maxFailedAttempts: int(process.env.AUTH_MAX_FAILED_ATTEMPTS, 10),
    lockoutMinutes: int(process.env.AUTH_LOCKOUT_MINUTES, 3),
    pinMinLength: int(process.env.AUTH_PIN_MIN_LENGTH, 4),
    pinMaxLength: int(process.env.AUTH_PIN_MAX_LENGTH, 12),
    // Whether the sign-in screen may list the accounts hospital IT has
    // provisioned together with the initial PIN that was issued with them.
    // Useful while a site is being commissioned and every account still holds
    // its issued PIN. Forced off in production: see the guard below.
    publishIssuedCredentials: bool(process.env.AUTH_PUBLISH_ISSUED_CREDENTIALS, true),
  },

  sso: {
    // Enterprise single sign-on. Accounts are never created by the identity
    // provider: the person must already be provisioned in the staff directory,
    // and the directory entry carries the subject claim that is matched here.
    enabled: bool(process.env.SSO_ENABLED, false),
    provider: process.env.SSO_PROVIDER || 'azure-ad',
    displayName: process.env.SSO_DISPLAY_NAME || 'Hospital single sign-on',
    authorizationEndpoint: process.env.SSO_AUTHORIZATION_ENDPOINT || '',
    tokenEndpoint: process.env.SSO_TOKEN_ENDPOINT || '',
    clientId: process.env.SSO_CLIENT_ID || '',
    clientSecret: process.env.SSO_CLIENT_SECRET || '',
    redirectUri: process.env.SSO_REDIRECT_URI || '',
    scopes: list(process.env.SSO_SCOPES, ['openid', 'profile', 'email']),
    subjectClaim: process.env.SSO_SUBJECT_CLAIM || 'preferred_username',
    timeoutMs: int(process.env.SSO_TIMEOUT_MS, 12000),
  },

  coldChain: {
    minCelsius: Number(process.env.COLD_MIN_C || 2),
    maxCelsius: Number(process.env.COLD_MAX_C || 8),
    sampleSeconds: int(process.env.COLD_SAMPLE_SECONDS, 15),
  },

  phi: {
    // Safe Harbor de-identification is always on for outbound ward alerts.
    // This switch only controls whether the raw (identified) payload is kept
    // server-side for the audit trail.
    retainSourceForAudit: bool(process.env.PHI_RETAIN_SOURCE_FOR_AUDIT, true),
    // Salt for the one-way patient pseudonym shown on ward devices. Changing it
    // invalidates every previously issued token, which is the intended
    // behaviour if you suspect a token map has leaked.
    pseudonymSalt: process.env.PHI_PSEUDONYM_SALT || 'coldchain-dev-pseudonym-salt',
  },

  logLevel: process.env.LOG_LEVEL || (NODE_ENV === 'test' ? 'silent' : 'info'),

  // Demo mode ships illustrative staff accounts and seeded data so the app can
  // be tried without a hospital provisioning system. Set DEMO_MODE=false before
  // any real deployment — accounts then come from the configured identity store.
  demoMode: bool(process.env.DEMO_MODE, NODE_ENV !== 'production'),
};

if (!['mock', 'live'].includes(config.dataMode)) {
  throw new Error(`DATA_MODE must be "mock" or "live", received "${config.dataMode}"`);
}

if (config.isProd && config.auth.secret === 'coldchain-dev-secret-change-me') {
  throw new Error('AUTH_SECRET must be set to a private value before running in production');
}

if (config.isProd && config.phi.pseudonymSalt === 'coldchain-dev-pseudonym-salt') {
  throw new Error('PHI_PSEUDONYM_SALT must be set to a private value before running in production');
}

// Issued credentials are a commissioning aid, never a production feature.
if (config.isProd) config.auth.publishIssuedCredentials = false;

config.sso.configured = Boolean(
  config.sso.enabled
  && config.sso.authorizationEndpoint
  && config.sso.tokenEndpoint
  && config.sso.clientId
  && config.sso.redirectUri,
);

module.exports = config;
