'use strict';

const { randomBytes, scryptSync, timingSafeEqual } = require('node:crypto');
const config = require('../../config');
const { badRequest, conflict, forbidden, notFound, unauthorized } = require('../../util/errors');

/**
 * The staff directory.
 *
 * There is no public sign-up anywhere in this product, and there is no code
 * path that creates an account from a sign-in attempt. A nurse, pharmacist,
 * courier or administrator can only sign in if hospital IT has already
 * provisioned them here against their official identity, and every account
 * carries the role that decides what they are allowed to do.
 *
 * In a hospital deployment this table is fed from the HR joiners/movers/leavers
 * feed, or the facility runs single sign-on and the directory entry carries the
 * identity provider's subject claim. Either way the shape below, and everything
 * that reads it, stays the same.
 */

const ROLE_SCOPES = {
  nurse: [
    'indent:read',
    'indent:request',
    'indent:receive',
    'notification:read',
    'audit:read',
  ],
  pharmacist: [
    'indent:read',
    'indent:verify',
    'indent:dispense',
    'indent:cancel',
    'notification:read',
    'audit:read',
    'hl7:ingest',
  ],
  courier: [
    'indent:read',
    'notification:read',
  ],
  admin: [
    'indent:read',
    'notification:read',
    'audit:read',
    'directory:read',
    'directory:manage',
    'hl7:ingest',
    'system:manage',
  ],
  // The interface engine account. It is never issued a PIN and never signs in
  // from a device; it exists so ingested HL7 traffic is attributable.
  system: [
    'indent:read',
    'indent:verify',
    'indent:dispense',
    'hl7:ingest',
    'audit:read',
    'notification:read',
  ],
};

const ROLE_TITLES = {
  nurse: 'Registered nurse',
  pharmacist: 'Clinical pharmacist',
  courier: 'Pharmacy courier',
  admin: 'System administrator',
  system: 'Interface service account',
};

/**
 * The accounts hospital IT issued when the service was commissioned. Each one
 * stands for a member of staff on the approved list, with the role their
 * department signed off. Nothing here can be created from the app.
 */
const PROVISIONED = [
  {
    id: 'NUR9931',
    name: 'Mim Hasan',
    role: 'nurse',
    ward: 'IPD-7B',
    department: 'Inpatient ward IPD-7B',
    pin: '4417',
    practitionerId: 'NUR9931',
  },
  {
    id: 'NUR9932',
    name: 'Farhana Yasmin',
    role: 'nurse',
    ward: 'IPD-9A',
    department: 'Inpatient ward IPD-9A',
    pin: '2210',
    practitionerId: 'NUR9931',
  },
  {
    id: 'PHARM2201',
    name: 'Rupom Saha',
    role: 'pharmacist',
    ward: null,
    department: 'Inpatient pharmacy',
    pin: '8890',
    practitionerId: 'PHARM2201',
  },
  {
    id: 'CUR-01',
    name: 'Rakib Mia',
    role: 'courier',
    ward: null,
    department: 'Pharmacy logistics',
    pin: '3364',
    practitionerId: 'CUR-01',
  },
  {
    id: 'ADM1004',
    name: 'Sabrina Rahman',
    role: 'admin',
    ward: null,
    department: 'Clinical systems and IT',
    pin: '7712',
    practitionerId: null,
  },
];

const accounts = new Map();

function hashPin(pin, salt = randomBytes(16).toString('hex')) {
  return { salt, hash: scryptSync(String(pin), salt, 64).toString('hex') };
}

function pinMatches(account, pin) {
  const candidate = scryptSync(String(pin || ''), account.credential.salt, 64);
  const stored = Buffer.from(account.credential.hash, 'hex');
  return candidate.length === stored.length && timingSafeEqual(candidate, stored);
}

function assertPinPolicy(pin) {
  const value = String(pin || '').trim();
  const { pinMinLength, pinMaxLength } = config.auth;
  if (!/^\d+$/.test(value)) throw badRequest('A PIN is digits only');
  if (value.length < pinMinLength || value.length > pinMaxLength) {
    throw badRequest(`A PIN is between ${pinMinLength} and ${pinMaxLength} digits`);
  }
  if (/^(\d)\1+$/.test(value)) throw badRequest('That PIN repeats a single digit. Choose another one.');
  if ('01234567890123456789'.includes(value) || '98765432109876543210'.includes(value)) {
    throw badRequest('That PIN runs in sequence. Choose another one.');
  }
  return value;
}

function makeAccount({ id, name, role, ward, department, pin, practitionerId, provisionedBy, ssoSubject }) {
  if (!ROLE_SCOPES[role]) throw badRequest(`"${role}" is not a role this service knows`);
  return {
    id: String(id).toUpperCase(),
    name,
    role,
    title: ROLE_TITLES[role],
    ward: ward || null,
    department: department || null,
    practitionerId: practitionerId || null,
    ssoSubject: ssoSubject || null,
    status: 'active',
    credential: hashPin(pin),
    // The PIN hospital IT handed over. It is cleared the moment the account
    // holder sets their own, and it is only readable through an endpoint the
    // deployment has to switch on.
    issuedPin: String(pin),
    mustChangePin: true,
    provisionedBy: provisionedBy || 'Hospital IT, on commissioning',
    provisionedAt: new Date().toISOString(),
    lastSignInAt: null,
    failedAttempts: 0,
    lockedUntil: null,
  };
}

function seed() {
  accounts.clear();
  for (const entry of PROVISIONED) accounts.set(entry.id.toUpperCase(), makeAccount(entry));
}

seed();

function isLocked(account) {
  return Boolean(account.lockedUntil && new Date(account.lockedUntil).getTime() > Date.now());
}

function minutesUntil(iso) {
  return Math.max(1, Math.ceil((new Date(iso).getTime() - Date.now()) / 60000));
}

/** What the directory is allowed to say about an account. Never the credential. */
function publicRecord(account) {
  return {
    id: account.id,
    name: account.name,
    role: account.role,
    title: account.title,
    ward: account.ward,
    department: account.department,
    status: account.status,
    mustChangePin: account.mustChangePin,
    usesSingleSignOn: Boolean(account.ssoSubject),
    provisionedBy: account.provisionedBy,
    provisionedAt: account.provisionedAt,
    lastSignInAt: account.lastSignInAt,
    locked: isLocked(account),
    scopes: ROLE_SCOPES[account.role] || [],
  };
}

function find(staffId) {
  return accounts.get(String(staffId || '').trim().toUpperCase()) || null;
}

function get(staffId) {
  const account = find(staffId);
  if (!account) throw notFound(`No account on the staff directory carries the ID ${String(staffId).toUpperCase()}`);
  return account;
}

function list() {
  return [...accounts.values()]
    .sort((a, b) => a.role.localeCompare(b.role) || a.name.localeCompare(b.name))
    .map(publicRecord);
}

/**
 * The accounts the sign-in screen may list, with the PIN they were issued.
 *
 * Off in production, and off anywhere the deployment sets
 * AUTH_PUBLISH_ISSUED_CREDENTIALS=false. Once an account holder has set a PIN
 * of their own the issued one is gone and is never shown again.
 */
function issuedAccess() {
  if (!config.auth.publishIssuedCredentials) return [];
  return [...accounts.values()]
    .filter((account) => account.status === 'active' && account.role !== 'system' && account.issuedPin)
    .map((account) => ({
      id: account.id,
      name: account.name,
      role: account.role,
      title: account.title,
      ward: account.ward,
      department: account.department,
      issuedPin: account.issuedPin,
    }));
}

function registerFailure(account) {
  account.failedAttempts += 1;
  if (account.failedAttempts >= config.auth.maxFailedAttempts) {
    account.lockedUntil = new Date(Date.now() + config.auth.lockoutMinutes * 60000).toISOString();
    account.failedAttempts = 0;
  }
}

/**
 * Authenticates a facility-issued credential.
 *
 * An unknown staff ID and a wrong PIN answer with the same message and cost the
 * same amount of work, so the endpoint cannot be used to find out who works
 * here.
 */
function authenticate(staffId, pin) {
  const account = find(staffId);
  const target = account && account.status === 'active' && !isLocked(account)
    ? account
    : { credential: hashPin('0000') };
  const ok = pinMatches(target, pin) && Boolean(account);

  if (!account) throw unauthorized('Staff ID or PIN is not recognised. Check both and try again.');
  if (account.status === 'suspended') {
    throw forbidden('This account has been suspended. Contact the hospital IT service desk.');
  }
  if (isLocked(account)) {
    const minutes = minutesUntil(account.lockedUntil);
    throw forbidden(`Too many incorrect attempts. This account unlocks in ${minutes} ${minutes === 1 ? 'minute' : 'minutes'}.`);
  }
  if (!ok) {
    registerFailure(account);
    throw unauthorized('Staff ID or PIN is not recognised. Check both and try again.');
  }

  account.failedAttempts = 0;
  account.lockedUntil = null;
  account.lastSignInAt = new Date().toISOString();
  return account;
}

/** Matches an identity provider subject claim onto an already-provisioned account. */
function authenticateBySubject(subject) {
  const value = String(subject || '').trim().toLowerCase();
  const account = value
    ? [...accounts.values()].find((entry) => entry.ssoSubject && entry.ssoSubject.toLowerCase() === value)
    : null;
  if (!account) {
    throw forbidden('That hospital account is not provisioned for ColdChain Rx. Contact the hospital IT service desk.');
  }
  if (account.status !== 'active') {
    throw forbidden('This account has been suspended. Contact the hospital IT service desk.');
  }
  account.lastSignInAt = new Date().toISOString();
  return account;
}

/** The account holder replaces the issued PIN with one only they know. */
function changePin(staffId, currentPin, nextPin) {
  const account = get(staffId);
  if (!pinMatches(account, currentPin)) throw unauthorized('That is not your current PIN');
  const value = assertPinPolicy(nextPin);
  if (pinMatches(account, value)) throw badRequest('Choose a PIN you are not already using');
  account.credential = hashPin(value);
  account.issuedPin = null;
  account.mustChangePin = false;
  return publicRecord(account);
}

function generatePin() {
  for (;;) {
    const pin = String(randomBytes(3).readUIntBE(0, 3) % 10000).padStart(4, '0');
    try {
      return assertPinPolicy(pin);
    } catch {
      // Rejected by the policy; draw another one.
    }
  }
}

/** Hospital IT creates an account for an approved member of staff. */
function provision(input, actor) {
  const id = String(input.id || '').trim().toUpperCase();
  if (accounts.has(id)) throw conflict(`An account already exists for ${id}`);
  const pin = input.pin ? assertPinPolicy(input.pin) : generatePin();
  const account = makeAccount({
    id,
    name: input.name,
    role: input.role,
    ward: input.ward,
    department: input.department,
    practitionerId: input.practitionerId || (['nurse', 'pharmacist'].includes(input.role) ? id : null),
    ssoSubject: input.ssoSubject,
    pin,
    provisionedBy: `${actor.name} (${actor.id})`,
  });
  accounts.set(account.id, account);
  return { account: publicRecord(account), issuedPin: pin };
}

function setStatus(staffId, status, actor) {
  if (!['active', 'suspended'].includes(status)) throw badRequest('Status is either active or suspended');
  const account = get(staffId);
  if (account.id === String(actor.id).toUpperCase() && status === 'suspended') {
    throw conflict('You cannot suspend the account you are signed in with');
  }
  account.status = status;
  if (status === 'active') {
    account.lockedUntil = null;
    account.failedAttempts = 0;
  }
  return publicRecord(account);
}

/** Issues a fresh PIN when someone has forgotten theirs. Shown to IT once. */
function resetPin(staffId) {
  const account = get(staffId);
  const pin = generatePin();
  account.credential = hashPin(pin);
  account.issuedPin = pin;
  account.mustChangePin = true;
  account.failedAttempts = 0;
  account.lockedUntil = null;
  return { account: publicRecord(account), issuedPin: pin };
}

function scopesFor(role) {
  return ROLE_SCOPES[role] || [];
}

function reset() {
  seed();
}

module.exports = {
  ROLE_SCOPES,
  ROLE_TITLES,
  assertPinPolicy,
  authenticate,
  authenticateBySubject,
  changePin,
  find,
  get,
  issuedAccess,
  list,
  provision,
  publicRecord,
  reset,
  resetPin,
  scopesFor,
  setStatus,
};
