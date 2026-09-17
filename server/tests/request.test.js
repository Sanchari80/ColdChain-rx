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
const fixtures = require('../src/services/fhir/fixtures');

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

test('a nurse sees the refrigerated prescriptions on their own ward only', async () => {
  const nurse = await signIn('NUR9931', '4417');
  const result = await api('/api/v1/indents/orderable', { token: nurse });
  assert.equal(result.status, 200);
  assert.equal(result.body.ward, 'IPD-7B');

  const ids = result.body.items.map((item) => item.prescriptionId).sort();
  assert.deepEqual(ids, ['MR-9001', 'MR-9002']);
  for (const item of result.body.items) {
    assert.equal(item.ward, 'IPD-7B');
    assert.match(item.subjectToken, /^SUBJ-/);
  }
});

test('the orderable list carries no patient identity', async () => {
  const nurse = await signIn('NUR9931', '4417');
  const result = await api('/api/v1/indents/orderable', { token: nurse });
  const text = JSON.stringify(result.body);
  for (const patient of fixtures.patients) {
    assert.ok(!text.includes(patient.name[0].family), `${patient.id} family name leaked`);
    assert.ok(!text.includes(patient.birthDate), `${patient.id} birth date leaked`);
    assert.ok(!text.includes(patient.identifier[0].value), `${patient.id} MRN leaked`);
  }
});

test('a ward request becomes an OMP^O09, is parsed, and lands on the pharmacy queue', async () => {
  const nurse = await signIn('NUR9931', '4417');
  const result = await api('/api/v1/indents/requests', {
    method: 'POST',
    token: nurse,
    body: { prescriptionId: 'MR-9001', doses: 2, priority: 'urgent', note: 'Bay 2 | before 9pm & after dinner' },
  });

  assert.equal(result.status, 201);
  const { indent, hl7 } = result.body;
  assert.match(indent.id, /^IND-\d{4}-\d{4}$/);
  assert.equal(indent.status, 'requested');
  assert.equal(indent.prescriptionId, 'MR-9001');
  assert.equal(indent.drug.rxcui, '311041');
  assert.equal(indent.drug.dispenseQuantity, 2);
  assert.equal(indent.priority, 'stat');
  assert.equal(indent.bedLabel, 'IPD-7B / 712-A');
  assert.equal(indent.requestedBy.id, 'NUR9931');

  assert.equal(hl7.messageType, 'OMP^O09');
  assert.equal(hl7.version, '2.5.1');
  assert.deepEqual(hl7.segments.slice(0, 6), ['MSH', 'PID', 'PV1', 'ORC', 'RXO', 'RXR']);
  assert.match(hl7.ack, /MSA\|AA\|/);
  assert.equal(hl7.acknowledgementCode, 'AA');

  // The ward device never receives the message itself, and so never the PID it carried.
  const text = JSON.stringify(result.body);
  assert.ok(!text.includes('Rahman'));
  assert.ok(!text.includes('MRN0012345'));
  assert.ok(!text.includes('19780412'));

  // The free-text note was escaped, not allowed to split the message.
  assert.ok(indentService.raw(indent.id).notes.some((line) => line.includes('Bay 2')));
});

test('the pharmacist can check a ward request against the prescription', async () => {
  const nurse = await signIn('NUR9931', '4417');
  const requested = await api('/api/v1/indents/requests', { method: 'POST', token: nurse, body: { prescriptionId: 'MR-9001' } });
  const pharmacist = await signIn('PHARM2201', '8890');

  const verified = await api(`/api/v1/indents/${requested.body.indent.id}/verify`, { method: 'POST', token: pharmacist });
  assert.equal(verified.status, 200);
  assert.equal(verified.body.indent.verification.verdict, 'pass');
});

test('the pharmacy is alerted, without patient identity', async () => {
  const nurse = await signIn('NUR9931', '4417');
  const requested = await api('/api/v1/indents/requests', { method: 'POST', token: nurse, body: { prescriptionId: 'MR-9002' } });
  const pharmacist = await signIn('PHARM2201', '8890');

  const feed = await api('/api/v1/notifications', { token: pharmacist });
  const alert = feed.body.items.find((item) => item.indentId === requested.body.indent.id);
  assert.ok(alert, 'no alert for the new request');
  assert.equal(alert.status, 'requested');
  assert.ok(!JSON.stringify(alert).includes('Hossain'));
});

test('a nurse cannot request for another ward', async () => {
  const nurse = await signIn('NUR9931', '4417');
  const result = await api('/api/v1/indents/requests', { method: 'POST', token: nurse, body: { prescriptionId: 'MR-9003' } });
  assert.equal(result.status, 403);
});

test('a stopped prescription cannot be requested', async () => {
  const nurse = await signIn('NUR9932', '2210');
  const result = await api('/api/v1/indents/requests', { method: 'POST', token: nurse, body: { prescriptionId: 'MR-9004' } });
  assert.equal(result.status, 409);
});

test('only ward staff raise requests', async () => {
  const pharmacist = await signIn('PHARM2201', '8890');
  const courier = await signIn('CUR-01', '3364');
  for (const token of [pharmacist, courier]) {
    const result = await api('/api/v1/indents/requests', { method: 'POST', token, body: { prescriptionId: 'MR-9001' } });
    assert.equal(result.status, 403);
  }
});

test('request numbers keep counting up', async () => {
  const nurse = await signIn('NUR9931', '4417');
  const first = await api('/api/v1/indents/requests', { method: 'POST', token: nurse, body: { prescriptionId: 'MR-9001' } });
  const second = await api('/api/v1/indents/requests', { method: 'POST', token: nurse, body: { prescriptionId: 'MR-9002' } });
  const number = (id) => Number(id.split('-').pop());
  assert.equal(number(second.body.indent.id), number(first.body.indent.id) + 1);
});
