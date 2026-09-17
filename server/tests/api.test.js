'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

process.env.LOG_LEVEL = 'silent';
process.env.DATA_MODE = 'mock';
process.env.NODE_ENV = 'test';

const { createApp } = require('../src/app');
const indentService = require('../src/services/indents/indentService');
const notifications = require('../src/services/notifications/store');
const audit = require('../src/services/audit/auditService');
const fhir = require('../src/services/fhir/fhirClient');

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
  assert.equal(result.status, 200, `login failed for ${staffId}`);
  return result.body.token;
}

test.before(async () => {
  server = createApp().listen(0);
  await new Promise((resolve) => server.once('listening', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

test.after(() => server && server.close());

test.beforeEach(async () => {
  notifications.reset();
  audit.reset();
  fhir._resetMock();
  await indentService.restoreBaseline();
});

test('health and capabilities are open and describe the deployment', async () => {
  const health = await api('/api/v1/health');
  assert.equal(health.status, 200);
  assert.equal(health.body.status, 'ok');

  const caps = await api('/api/v1/capabilities');
  assert.equal(caps.body.dataMode, 'mock');
  assert.ok(caps.body.standards.some((s) => s.includes('OMP^O09')));
});

test('protected routes reject a missing or forged token', async () => {
  assert.equal((await api('/api/v1/indents')).status, 401);
  assert.equal((await api('/api/v1/indents', { token: 'garbage' })).status, 401);

  const token = await signIn('PHARM2201', '8890');
  const [payload] = token.split('.');
  assert.equal((await api('/api/v1/indents', { token: `${payload}.wrongsignature` })).status, 401);
});

test('a wrong PIN is refused', async () => {
  const result = await api('/api/v1/auth/login', { method: 'POST', body: { staffId: 'PHARM2201', pin: '0000' } });
  assert.equal(result.status, 401);
});

test('the seeded ward list comes back with a spread of states', async () => {
  const token = await signIn('PHARM2201', '8890');
  const { body } = await api('/api/v1/indents', { token });
  assert.equal(body.items.length, 4);
  const statuses = body.items.map((item) => item.status);
  assert.ok(statuses.includes('in-transit'));
  assert.ok(statuses.includes('blocked'));
});

test('no response on the indent list contains patient demographics', async () => {
  const token = await signIn('PHARM2201', '8890');
  const { body } = await api('/api/v1/indents', { token });
  const serialised = JSON.stringify(body);
  for (const leak of ['Rahman', 'Ayesha', 'MRN0012345', '1978-04-12', '8801711000001', 'Gulshan']) {
    assert.equal(serialised.includes(leak), false, `${leak} leaked into the indent list`);
  }
  assert.match(body.items[0].subjectToken, /^SUBJ-[0-9A-F]{10}$/);
});

test('verifying a wrong-strength indent blocks it', async () => {
  const token = await signIn('PHARM2201', '8890');
  const { status, body } = await api('/api/v1/indents/IND-2026-0092/verify', { method: 'POST', token });
  assert.equal(status, 200);
  assert.equal(body.indent.verification.verdict, 'fail');
  assert.equal(body.indent.status, 'blocked');
  assert.ok(body.indent.verification.checks.some((c) => c.code === 'strength-mismatch'));
});

test('a blocked indent cannot be dispensed', async () => {
  const token = await signIn('PHARM2201', '8890');
  await api('/api/v1/indents/IND-2026-0092/verify', { method: 'POST', token });
  const result = await api('/api/v1/indents/IND-2026-0092/dispense', { method: 'POST', token, body: {} });
  assert.equal(result.status, 403);
});

test('an unverified indent cannot be dispensed', async () => {
  const token = await signIn('PHARM2201', '8890');
  const result = await api('/api/v1/indents/IND-2026-0092/dispense', { method: 'POST', token, body: {} });
  assert.equal(result.status, 409);
});

test('the full happy path: verify, dispense, receive', async () => {
  const pharmacist = await signIn('PHARM2201', '8890');

  const verified = await api('/api/v1/indents/IND-2026-0091/verify', { method: 'POST', token: pharmacist });
  assert.equal(verified.body.indent.verification.verdict, 'pass');

  const dispensed = await api('/api/v1/indents/IND-2026-0091/dispense', { method: 'POST', token: pharmacist, body: { courierId: 'CUR-01' } });
  assert.equal(dispensed.status, 201);
  assert.equal(dispensed.body.indent.status, 'in-transit');
  assert.equal(dispensed.body.indent.delivery.courier.name, 'Rakib Mia');
  assert.ok(dispensed.body.indent.delivery.medicationDispenseId);
  assert.ok(new Date(dispensed.body.indent.delivery.eta) > new Date());

  const nurse = await signIn('NUR9931', '4417');
  const received = await api('/api/v1/indents/IND-2026-0091/receive', { method: 'POST', token: nurse, body: {} });
  assert.equal(received.status, 200);
  assert.equal(received.body.indent.status, 'delivered');

  const dispense = await fhir.read('MedicationDispense', dispensed.body.indent.delivery.medicationDispenseId);
  assert.equal(dispense.resourceType, 'MedicationDispense');
  assert.equal(dispense.status, 'completed');
  assert.ok(dispense.whenHandedOver);
  assert.equal(dispense.authorizingPrescription[0].reference, 'MedicationRequest/MR-9001');
});

test('the ward alert carries courier and ETA but no patient identity', async () => {
  const pharmacist = await signIn('PHARM2201', '8890');
  await api('/api/v1/indents/IND-2026-0091/verify', { method: 'POST', token: pharmacist });
  await api('/api/v1/indents/IND-2026-0091/dispense', { method: 'POST', token: pharmacist, body: { courierId: 'CUR-01' } });

  const { body } = await api('/api/v1/notifications?ward=IPD-7B', { token: pharmacist });
  const alert = body.items.find((item) => item.indentId === 'IND-2026-0091');
  assert.ok(alert);
  assert.equal(alert.courier.staffName, 'Rakib Mia');
  assert.equal(alert.bed, '712-A');
  assert.ok(alert.eta);

  const serialised = JSON.stringify(alert);
  for (const leak of ['Rahman', 'Ayesha', 'MRN0012345', '1978-04-12', 'Gulshan']) {
    assert.equal(serialised.includes(leak), false, `${leak} leaked into a ward alert`);
  }
  assert.equal('name' in alert, false);
  assert.equal('birthDate' in alert, false);
});

test('a nurse may receive but may not dispense', async () => {
  const nurse = await signIn('NUR9931', '4417');
  const blocked = await api('/api/v1/indents/IND-2026-0091/dispense', { method: 'POST', token: nurse, body: {} });
  assert.equal(blocked.status, 403);
  assert.match(blocked.body.error.message, /nurse/);

  const allowed = await api('/api/v1/indents', { token: nurse });
  assert.equal(allowed.status, 200);
});

test('an override reason is required when verification only warns', async () => {
  const token = await signIn('PHARM2201', '8890');
  const nurse = await signIn('NUR9931', '4417');

  // First dose goes out normally.
  await api('/api/v1/indents/IND-2026-0091/verify', { method: 'POST', token });
  await api('/api/v1/indents/IND-2026-0091/dispense', { method: 'POST', token, body: {} });
  await api('/api/v1/indents/IND-2026-0091/receive', { method: 'POST', token: nurse, body: {} });

  // The ward raises a second indent for the same order a few minutes later.
  const { body: sampleBody } = await api('/api/v1/hl7/templates', { token });
  const repeat = sampleBody.templates
    .find((s) => s.key === 'valid').message
    .replace('IND-2026-0091', 'IND-2026-0095')
    .replace('MSG00012', 'MSG00020');
  const ingested = await api('/api/v1/hl7/ingest', { method: 'POST', token, body: { message: repeat } });
  assert.equal(ingested.status, 201);

  const reverified = await api('/api/v1/indents/IND-2026-0095/verify', { method: 'POST', token });
  assert.equal(reverified.body.indent.verification.verdict, 'review');
  assert.ok(reverified.body.indent.verification.checks.some((c) => c.code === 'possible-duplicate'));

  const withoutReason = await api('/api/v1/indents/IND-2026-0095/dispense', { method: 'POST', token, body: {} });
  assert.equal(withoutReason.status, 409);
  assert.ok(withoutReason.body.error.details.warnings.length > 0);

  const withReason = await api('/api/v1/indents/IND-2026-0095/dispense', {
    method: 'POST',
    token,
    body: { overrideReason: 'Evening dose is separately charted and due now' },
  });
  assert.equal(withReason.status, 201);
  assert.match(withReason.body.indent.delivery.overrideReason, /Evening dose/);
});

test('a delivered indent cannot be re-verified', async () => {
  const token = await signIn('PHARM2201', '8890');
  const nurse = await signIn('NUR9931', '4417');
  await api('/api/v1/indents/IND-2026-0091/verify', { method: 'POST', token });
  await api('/api/v1/indents/IND-2026-0091/dispense', { method: 'POST', token, body: {} });
  await api('/api/v1/indents/IND-2026-0091/receive', { method: 'POST', token: nurse, body: {} });

  const result = await api('/api/v1/indents/IND-2026-0091/verify', { method: 'POST', token });
  assert.equal(result.status, 409);
});

test('a cold-chain excursion puts the dispense on hold instead of completing it', async () => {
  const pharmacist = await signIn('PHARM2201', '8890');
  const nurse = await signIn('NUR9931', '4417');

  const telemetry = await api('/api/v1/coldchain/IND-2026-0094', { token: pharmacist });
  assert.equal(telemetry.status, 200);
  assert.equal(telemetry.body.summary.breached, true);
  assert.ok(telemetry.body.readings.length > 5);

  const received = await api('/api/v1/indents/IND-2026-0094/receive', { method: 'POST', token: nurse, body: {} });
  assert.equal(received.body.indent.status, 'delivered');

  const dispense = await fhir.read('MedicationDispense', received.body.indent.delivery.medicationDispenseId);
  assert.equal(dispense.status, 'on-hold');
});

test('HL7 ingest accepts a good message and answers with an AA acknowledgement', async () => {
  const token = await signIn('PHARM2201', '8890');
  const { body: sampleBody } = await api('/api/v1/hl7/templates', { token });
  const sample = sampleBody.templates.find((s) => s.key === 'valid');

  const result = await api('/api/v1/hl7/ingest', { method: 'POST', token, body: { message: sample.message } });
  assert.equal(result.status, 201);
  assert.match(result.body.ack.split('\r')[1], /^MSA\|AA\|MSG00012/);
  assert.equal(result.body.parsed.patientIncluded, false);
  assert.equal(JSON.stringify(result.body.parsed).includes('Rahman'), false);
});

test('HL7 ingest rejects the wrong message type and still acknowledges', async () => {
  const token = await signIn('PHARM2201', '8890');
  const { body: sampleBody } = await api('/api/v1/hl7/templates', { token });
  const sample = sampleBody.templates.find((s) => s.key === 'wrongMessageType');

  const result = await api('/api/v1/hl7/ingest', { method: 'POST', token, body: { message: sample.message } });
  assert.equal(result.status, 400);
  assert.match(result.body.ack.split('\r')[1], /^MSA\|AE\|/);
});

test('every action leaves an intact audit trail', async () => {
  const token = await signIn('PHARM2201', '8890');
  await api('/api/v1/indents/IND-2026-0091/verify', { method: 'POST', token });
  await api('/api/v1/indents/IND-2026-0091/dispense', { method: 'POST', token, body: {} });

  const { body } = await api('/api/v1/audit', { token });
  assert.equal(body.integrity.valid, true);
  assert.ok(body.entries.length >= 3);
  assert.ok(body.entries.some((entry) => entry.subtype === 'create'));
  assert.ok(body.entries.some((entry) => entry.action === 'R'));

  const fhirAudit = await api('/api/v1/audit/fhir', { token });
  assert.ok(fhirAudit.body.events.every((event) => event.resourceType === 'AuditEvent'));
});

test('validation errors name the field that needs fixing', async () => {
  const token = await signIn('PHARM2201', '8890');
  const result = await api('/api/v1/indents/IND-2026-0091/cancel', { method: 'POST', token, body: { reason: 'x' } });
  assert.equal(result.status, 400);
  assert.equal(result.body.error.details[0].field, 'reason');
});

test('an unknown indent returns a clear 404', async () => {
  const token = await signIn('PHARM2201', '8890');
  const result = await api('/api/v1/indents/IND-NOPE/verify', { method: 'POST', token });
  assert.equal(result.status, 404);
  assert.match(result.body.error.message, /does not exist/);
});
