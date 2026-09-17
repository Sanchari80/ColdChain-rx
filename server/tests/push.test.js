'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

process.env.LOG_LEVEL = 'silent';
process.env.DATA_MODE = 'mock';
process.env.NODE_ENV = 'test';
process.env.PUSH_ENABLED = 'true';

const { createApp } = require('../src/app');
const indentService = require('../src/services/indents/indentService');
const notifications = require('../src/services/notifications/store');
const push = require('../src/services/notifications/push');
const audit = require('../src/services/audit/auditService');
const fhir = require('../src/services/fhir/fhirClient');

const WARD_7B_PHONE = 'ExponentPushToken[nurse-ipd-7b]';
const WARD_9A_PHONE = 'ExponentPushToken[nurse-ipd-9a]';
const PHARMACY_PHONE = 'ExponentPushToken[pharmacist]';

let server;
let base;
let sent;
let tickets;

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
  assert.equal(result.status, 200, `login failed for ${staffId}`);
  return result.body.token;
}

async function registerPhone(staffId, pin, pushToken) {
  const session = await signIn(staffId, pin);
  const result = await api('/api/v1/notifications/devices', {
    method: 'POST',
    token: session,
    body: { token: pushToken, platform: 'android' },
  });
  assert.equal(result.status, 201);
  return session;
}

/** Pushes are fired without being awaited, so give them a moment to leave. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 50));

test.before(async () => {
  server = createApp().listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

test.after(() => {
  push._setTransport(null);
  return server && server.close();
});

test.beforeEach(async () => {
  notifications.reset();
  audit.reset();
  fhir._resetMock();
  await indentService.restoreBaseline();
  push._reset();
  sent = [];
  tickets = null;
  push._setTransport(async (messages) => {
    sent.push(...messages);
    return tickets ? tickets(messages) : messages.map(() => ({ status: 'ok', id: 'ticket' }));
  });
});

test('a phone must send a real Expo push token', async () => {
  const session = await signIn('NUR9931', '4417');
  const result = await api('/api/v1/notifications/devices', {
    method: 'POST',
    token: session,
    body: { token: 'not-a-token' },
  });
  assert.equal(result.status, 400);
  assert.equal(push.deviceCount(), 0);
});

test('a dispatch wakes the ward it is going to, and nobody else', async () => {
  await registerPhone('NUR9931', '4417', WARD_7B_PHONE);
  await registerPhone('NUR9932', '2210', WARD_9A_PHONE);
  const pharmacist = await registerPhone('PHARM2201', '8890', PHARMACY_PHONE);

  const dispatched = await api('/api/v1/indents/IND-2026-0091/dispense', {
    method: 'POST',
    token: pharmacist,
    body: { courierId: 'CUR-02' },
  });
  assert.equal(dispatched.status, 201);
  await settle();

  // IND-2026-0091 is for IPD-7B. The IPD-9A nurse is not told, and the
  // pharmacist who dispatched it is not told about their own action.
  assert.deepEqual(sent.map((message) => message.to), [WARD_7B_PHONE]);
  const [message] = sent;
  assert.match(message.title, /^On the way: Insulin Glargine/);
  assert.match(message.body, /IPD-7B/);
  assert.equal(message.channelId, 'ward-alerts');
  assert.equal(message.priority, 'high');
  assert.equal(message.data.indentId, 'IND-2026-0091');
});

test('the push carries no patient identity', async () => {
  await registerPhone('NUR9931', '4417', WARD_7B_PHONE);
  const pharmacist = await signIn('PHARM2201', '8890');
  await api('/api/v1/indents/IND-2026-0091/dispense', { method: 'POST', token: pharmacist, body: { courierId: 'CUR-02' } });
  await settle();

  const patient = await fhir.read('Patient', indentService.raw('IND-2026-0091').patientId);
  const text = JSON.stringify(sent);
  for (const entry of patient.name || []) {
    if (entry.family) assert.ok(!text.includes(entry.family), 'family name leaked into a push');
  }
  if (patient.birthDate) assert.ok(!text.includes(patient.birthDate), 'birth date leaked into a push');
});

test('rebuilding the demo queue does not wake any phone', async () => {
  await registerPhone('NUR9931', '4417', WARD_7B_PHONE);
  await indentService.restoreBaseline();
  await settle();
  assert.equal(sent.length, 0);
});

test('a phone that uninstalled the app is dropped', async () => {
  await registerPhone('NUR9931', '4417', WARD_7B_PHONE);
  tickets = (messages) => messages.map(() => ({ status: 'error', details: { error: 'DeviceNotRegistered' } }));
  const pharmacist = await signIn('PHARM2201', '8890');
  await api('/api/v1/indents/IND-2026-0091/dispense', { method: 'POST', token: pharmacist, body: { courierId: 'CUR-02' } });
  await settle();
  assert.equal(push.deviceCount(), 0);
});

test('signing out stops alerts on that phone', async () => {
  const nurse = await registerPhone('NUR9931', '4417', WARD_7B_PHONE);
  const removed = await api('/api/v1/notifications/devices/remove', {
    method: 'POST',
    token: nurse,
    body: { token: WARD_7B_PHONE },
  });
  assert.equal(removed.body.removed, true);

  const pharmacist = await signIn('PHARM2201', '8890');
  await api('/api/v1/indents/IND-2026-0091/dispense', { method: 'POST', token: pharmacist, body: { courierId: 'CUR-02' } });
  await settle();
  assert.equal(sent.length, 0);
});

test('a push service outage does not break the dispatch', async () => {
  await registerPhone('NUR9931', '4417', WARD_7B_PHONE);
  push._setTransport(async () => { throw new Error('push service down'); });
  const pharmacist = await signIn('PHARM2201', '8890');
  const dispatched = await api('/api/v1/indents/IND-2026-0091/dispense', {
    method: 'POST',
    token: pharmacist,
    body: { courierId: 'CUR-02' },
  });
  assert.equal(dispatched.status, 201);
});
