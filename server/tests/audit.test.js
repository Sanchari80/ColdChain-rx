'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

process.env.LOG_LEVEL = 'silent';
const audit = require('../src/services/audit/auditService');

const actor = { id: 'PHARM2201', name: 'Rupom Saha', role: 'pharmacist' };

async function seed(count = 3) {
  audit.reset();
  for (let i = 0; i < count; i += 1) {
    await audit.record({
      action: 'R',
      subtypeCode: 'read',
      actor,
      patientRef: 'Patient/P-1001',
      entities: [{ reference: `MedicationRequest/MR-900${i + 1}` }],
      summary: `read ${i}`,
    });
  }
}

test('every entry links to the one before it', async () => {
  await seed(4);
  const entries = audit.list({ limit: 10 }).reverse();
  for (let i = 1; i < entries.length; i += 1) {
    assert.equal(entries[i].previousHash, entries[i - 1].hash);
  }
});

test('an untouched chain verifies', async () => {
  await seed(5);
  const result = audit.verify();
  assert.equal(result.valid, true);
  assert.equal(result.length, 5);
  assert.match(result.headHash, /^[0-9a-f]{64}$/);
});

test('editing an entry breaks verification at that point', async () => {
  await seed(5);
  audit.chain[2].summary = 'quietly changed';
  const result = audit.verify();
  assert.equal(result.valid, false);
  assert.equal(result.brokenAt, 3);
});

test('deleting an entry breaks verification', async () => {
  await seed(5);
  audit.chain.splice(2, 1);
  assert.equal(audit.verify().valid, false);
});

test('a write to FHIR produces a resource id on the chain entry', async () => {
  await seed(1);
  assert.ok(audit.list()[0].auditEventId);
  assert.equal(audit.list()[0].pendingSync, false);
});

test('audit entries carry references, never patient demographics', async () => {
  await seed(3);
  const serialised = JSON.stringify(audit.list());
  assert.equal(serialised.includes('Rahman'), false);
  assert.equal(serialised.includes('MRN0012345'), false);
  assert.ok(serialised.includes('Patient/P-1001'));
});
