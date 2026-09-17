'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

process.env.LOG_LEVEL = 'silent';
process.env.DATA_MODE = 'mock';
process.env.NODE_ENV = 'test';

const { createApp } = require('../src/app');
const directory = require('../src/services/identity/directory');
const indentService = require('../src/services/indents/indentService');
const notifications = require('../src/services/notifications/store');
const audit = require('../src/services/audit/auditService');
const fhir = require('../src/services/fhir/fhirClient');
const config = require('../src/config');

let server;
let base;

async function api(path, { method = 'GET', token, body } = {}) {
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const response = await fetch(`${base}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : null };
}

async function signIn(staffId, pin) {
  const result = await api('/api/v1/auth/login', { method: 'POST', body: { staffId, pin } });
  assert.equal(result.status, 200, `sign-in failed for ${staffId}: ${JSON.stringify(result.body)}`);
  return result.body.token;
}

test.before(async () => {
  server = createApp().listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

test.after(() => server && server.close());

test.beforeEach(async () => {
  directory.reset();
  notifications.reset();
  audit.reset();
  fhir._resetMock();
  await indentService.restoreBaseline();
});

test('the service advertises that accounts are issued, not self-created', async () => {
  const { status, body } = await api('/api/v1/auth/methods');
  assert.equal(status, 200);
  assert.equal(body.selfRegistration, false);
  assert.equal(body.credentials.enabled, true);
  assert.ok(body.support.desk);
  assert.equal(body.singleSignOn.enabled, false);
});

test('there is no registration endpoint to create an account with', async () => {
  for (const path of ['/api/v1/auth/register', '/api/v1/auth/signup', '/api/v1/directory/register']) {
    const { status } = await api(path, { method: 'POST', body: { staffId: 'NEW1', pin: '1234' } });
    assert.equal(status, 404, `${path} should not exist`);
  }
});

test('an unknown staff ID and a wrong PIN are indistinguishable', async () => {
  const unknown = await api('/api/v1/auth/login', { method: 'POST', body: { staffId: 'NOBODY1', pin: '4417' } });
  const wrongPin = await api('/api/v1/auth/login', { method: 'POST', body: { staffId: 'NUR9931', pin: '0000' } });
  assert.equal(unknown.status, 401);
  assert.equal(wrongPin.status, 401);
  assert.equal(unknown.body.error.message, wrongPin.body.error.message);
});

test('an account locks itself after repeated wrong PINs', async () => {
  for (let attempt = 0; attempt < config.auth.maxFailedAttempts; attempt += 1) {
    await api('/api/v1/auth/login', { method: 'POST', body: { staffId: 'NUR9932', pin: '0000' } });
  }
  const locked = await api('/api/v1/auth/login', { method: 'POST', body: { staffId: 'NUR9932', pin: '2210' } });
  assert.equal(locked.status, 403);
  assert.match(locked.body.error.message, /unlocks in/);
});

test('a nurse only sees the ward they are assigned to', async () => {
  const token = await signIn('NUR9931', '4417');
  const { body } = await api('/api/v1/indents', { token });
  assert.ok(body.items.length > 0);
  assert.ok(body.items.every((item) => item.ward === 'IPD-7B'));
  assert.equal(body.scope.ward, 'IPD-7B');
});

test('a courier sees only the trips assigned to them', async () => {
  const token = await signIn('CUR-01', '3364');
  const { status, body } = await api('/api/v1/indents', { token });
  assert.equal(status, 200);
  assert.ok(body.items.every((item) => item.delivery && item.delivery.courier.id === 'CUR-01'));
  // The whole board is larger than what this courier is carrying.
  const pharmacist = await signIn('PHARM2201', '8890');
  const board = await api('/api/v1/indents', { token: pharmacist });
  assert.ok(board.body.items.length > body.items.length);

  const denied = await api('/api/v1/indents/IND-2026-0091/verify', { method: 'POST', token });
  assert.equal(denied.status, 403);
});

test('only an administrator can read or change the staff directory', async () => {
  const nurse = await signIn('NUR9931', '4417');
  assert.equal((await api('/api/v1/directory', { token: nurse })).status, 403);
  assert.equal((await api('/api/v1/directory', { method: 'POST', token: nurse, body: { id: 'NUR1', name: 'X Y', role: 'nurse' } })).status, 403);

  const admin = await signIn('ADM1004', '7712');
  const { status, body } = await api('/api/v1/directory', { token: admin });
  assert.equal(status, 200);
  assert.ok(body.accounts.length >= 5);
  assert.ok(body.accounts.every((account) => !('credential' in account)));
});

test('an administrator provisions an account and the holder then owns the PIN', async () => {
  const admin = await signIn('ADM1004', '7712');
  const created = await api('/api/v1/directory', {
    method: 'POST',
    token: admin,
    body: { id: 'NUR7788', name: 'Nadia Karim', role: 'nurse', ward: 'ICU-3', department: 'Critical care' },
  });
  assert.equal(created.status, 201);
  assert.match(created.body.issuedPin, /^\d{4}$/);
  assert.equal(created.body.account.status, 'active');
  assert.equal(created.body.account.mustChangePin, true);

  const token = await signIn('NUR7788', created.body.issuedPin);
  const changed = await api('/api/v1/auth/pin', {
    method: 'POST',
    token,
    body: { currentPin: created.body.issuedPin, newPin: '8264' },
  });
  assert.equal(changed.status, 200);
  assert.equal(changed.body.account.mustChangePin, false);

  const stale = await api('/api/v1/auth/login', { method: 'POST', body: { staffId: 'NUR7788', pin: created.body.issuedPin } });
  assert.equal(stale.status, 401);
  await signIn('NUR7788', '8264');
});

test('a PIN that would be trivial to guess is refused', async () => {
  const token = await signIn('NUR9931', '4417');
  for (const newPin of ['1111', '1234', '12']) {
    const { status } = await api('/api/v1/auth/pin', { method: 'POST', token, body: { currentPin: '4417', newPin } });
    assert.equal(status, 400, `${newPin} should be refused`);
  }
});

test('a suspended account loses access immediately, token and all', async () => {
  const admin = await signIn('ADM1004', '7712');
  const nurse = await signIn('NUR9931', '4417');
  assert.equal((await api('/api/v1/indents', { token: nurse })).status, 200);

  const suspended = await api('/api/v1/directory/NUR9931/status', { method: 'POST', token: admin, body: { status: 'suspended' } });
  assert.equal(suspended.status, 200);
  assert.equal(suspended.body.account.status, 'suspended');

  assert.equal((await api('/api/v1/indents', { token: nurse })).status, 403);
  assert.equal((await api('/api/v1/auth/login', { method: 'POST', body: { staffId: 'NUR9931', pin: '4417' } })).status, 403);
});

test('an administrator cannot suspend their own account', async () => {
  const admin = await signIn('ADM1004', '7712');
  const { status } = await api('/api/v1/directory/ADM1004/status', { method: 'POST', token: admin, body: { status: 'suspended' } });
  assert.equal(status, 409);
});

test('a reissued PIN replaces the old one and must be changed again', async () => {
  const admin = await signIn('ADM1004', '7712');
  const reset = await api('/api/v1/directory/NUR9932/pin-reset', { method: 'POST', token: admin });
  assert.equal(reset.status, 200);
  assert.equal(reset.body.account.mustChangePin, true);

  assert.equal((await api('/api/v1/auth/login', { method: 'POST', body: { staffId: 'NUR9932', pin: '2210' } })).status, 401);
  await signIn('NUR9932', reset.body.issuedPin);
});

test('single sign-on refuses to start until the facility has configured it', async () => {
  const { status, body } = await api('/api/v1/auth/sso/start', { method: 'POST', body: {} });
  assert.equal(status, 400);
  assert.match(body.error.message, /not set up for this facility/);
});

test('account administration is written to the audit trail', async () => {
  const admin = await signIn('ADM1004', '7712');
  await api('/api/v1/directory', {
    method: 'POST',
    token: admin,
    body: { id: 'CUR-09', name: 'Imran Sheikh', role: 'courier', department: 'Pharmacy logistics' },
  });
  const { body } = await api('/api/v1/audit?limit=20', { token: admin });
  assert.ok(body.entries.some((entry) => String(entry.summary).includes('provisioned CUR-09')));
  assert.equal(body.integrity.valid, true);
});
