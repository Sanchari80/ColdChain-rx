'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

process.env.LOG_LEVEL = 'silent';
const phi = require('../src/services/phi/deidentify');

const patient = {
  name: [{ family: 'Rahman', given: ['Ayesha', 'Binte'] }],
  birthDate: '1978-04-12',
  identifier: [{ value: 'MRN0012345' }],
  telecom: [{ value: '+8801711000001' }],
  address: [{ line: ['12 Gulshan Avenue'], postalCode: '1212' }],
};
const known = phi.knownIdentifiersOf(patient, null);

function alert(overrides = {}) {
  return phi.buildWardAlert({
    indent: { id: 'IND-2026-0091', patientId: 'P-1001' },
    courier: { id: 'CUR-01', name: 'Rakib Mia', role: 'Pharmacy porter' },
    etaIso: '2026-09-16T11:04:00.000Z',
    drugDisplay: 'Insulin Glargine 100 UNT/ML Injectable Solution',
    doseSummary: '18 International Unit',
    coldChain: { minCelsius: 2, maxCelsius: 8, currentCelsius: 4.4, breached: false },
    status: 'in-transit',
    severity: 'info',
    bed: '712-A',
    ward: 'IPD-7B',
    ...overrides,
  });
}

test('a correctly built ward alert carries no PHI', () => {
  const payload = alert();
  assert.deepEqual(phi.findPhi(payload, known), []);
  assert.doesNotThrow(() => phi.assertNoPhi(payload, known));
});

test('the alert keeps the operational facts a nurse needs', () => {
  const payload = alert();
  assert.equal(payload.ward, 'IPD-7B');
  assert.equal(payload.bed, '712-A');
  assert.equal(payload.courier.staffName, 'Rakib Mia');
  assert.equal(payload.eta, '2026-09-16T11:04:00.000Z');
  assert.equal(payload.coldChain.currentCelsius, 4.4);
});

test('a patient name added anywhere is caught', () => {
  const payload = { ...alert(), note: 'For Ayesha Rahman in 712-A' };
  const findings = phi.findPhi(payload, known);
  assert.ok(findings.some((f) => f.code === 'known-identifier'));
  assert.throws(() => phi.assertNoPhi(payload, known), /PHI leak/);
});

test('an MRN is caught even when it is punctuated differently', () => {
  const payload = { ...alert(), reference: 'MRN-0012345' };
  assert.ok(phi.findPhi(payload, known).length > 0);
});

test('a phone number is caught with no prior knowledge of the patient', () => {
  const payload = { ...alert(), callback: '+880 1711 000001' };
  assert.ok(phi.findPhi(payload, []).some((f) => ['phone', 'known-identifier'].includes(f.code)));
});

test('a date of birth is caught with no prior knowledge of the patient', () => {
  const payload = { ...alert(), born: '1978-04-12' };
  assert.ok(phi.findPhi(payload, []).some((f) => f.code === 'calendar-date'));
});

test('an email address is caught', () => {
  const payload = { ...alert(), contact: 'ayesha.rahman@example.com' };
  assert.ok(phi.findPhi(payload, []).some((f) => f.code === 'email'));
});

test('a field literally named birthDate is refused even when empty', () => {
  const payload = { ...alert(), birthDate: '' };
  assert.ok(phi.findPhi(payload, []).some((f) => f.code === 'identifier-field'));
});

test('operational timestamps are allowed where patient dates are not', () => {
  const payload = { ...alert(), packedAt: '2026-09-16T10:55:00.000Z' };
  assert.deepEqual(phi.findPhi(payload, known), []);
});

test('a name needle does not fire on a coincidental substring', () => {
  // A patient called "Ram" must not make every ramipril alert unsendable.
  const ramPatient = { name: [{ family: 'Ram', given: ['Kumar'] }] };
  const payload = { ...alert({ drugDisplay: 'Ramipril 5 MG Oral Capsule' }) };
  assert.deepEqual(phi.findPhi(payload, phi.knownIdentifiersOf(ramPatient, null)), []);
});

test('pseudonyms are stable per patient and different between patients', () => {
  assert.equal(phi.pseudonym('P-1001'), phi.pseudonym('P-1001'));
  assert.notEqual(phi.pseudonym('P-1001'), phi.pseudonym('P-1002'));
  assert.match(phi.pseudonym('P-1001'), /^SUBJ-[0-9A-F]{10}$/);
});

test('scrub removes identifier-shaped keys at any depth', () => {
  const scrubbed = phi.scrub({ a: { name: 'x', keep: 1, b: [{ phone: '1', ok: 2 }] } });
  assert.equal(scrubbed.a.name, undefined);
  assert.equal(scrubbed.a.keep, 1);
  assert.equal(scrubbed.a.b[0].phone, undefined);
  assert.equal(scrubbed.a.b[0].ok, 2);
});
