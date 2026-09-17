'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

process.env.LOG_LEVEL = 'silent';
const rxnorm = require('../src/services/rxnorm/rxnormClient');

test('identical codes pass', async () => {
  const result = await rxnorm.compare({ prescribedRxcui: '311041', requestedRxcui: '311041' });
  assert.equal(result.verdict, 'pass');
  assert.equal(result.findings[0].code, 'exact-match');
});

test('same ingredient at a different strength fails', async () => {
  const result = await rxnorm.compare({ prescribedRxcui: '311041', requestedRxcui: '1605101' });
  assert.equal(result.verdict, 'fail');
  assert.ok(result.findings.some((f) => f.code === 'strength-mismatch'));
});

test('a different ingredient fails', async () => {
  const result = await rxnorm.compare({ prescribedRxcui: '311041', requestedRxcui: '1670007' });
  assert.equal(result.verdict, 'fail');
  assert.ok(result.findings.some((f) => f.code === 'ingredient-mismatch'));
});

test('same strength in a different dose form needs a pharmacist', async () => {
  const result = await rxnorm.compare({ prescribedRxcui: '311041', requestedRxcui: '847232' });
  assert.equal(result.verdict, 'review');
  assert.ok(result.findings.some((f) => f.code === 'form-mismatch'));
});

test('an unresolvable code fails rather than passing quietly', async () => {
  const result = await rxnorm.compare({ prescribedRxcui: '311041', requestedRxcui: '999999999' });
  assert.equal(result.verdict, 'fail');
  assert.ok(result.findings.some((f) => f.code === 'request-unresolvable'));
});

test('a brand name resolves to the same concept as its generic', async () => {
  const brand = await rxnorm.findByName('Lantus');
  assert.equal(brand.rxcui, '311041');
  assert.equal(brand.matchType, 'brand');
});

test('name lookup ignores case and punctuation', async () => {
  const found = await rxnorm.findByName('insulin glargine 100 unt/ml injectable solution');
  assert.equal(found.rxcui, '311041');
});

test('cold chain rules come from the concept, not the drug name', () => {
  assert.equal(rxnorm.coldChainFor('311041').required, true);
  assert.equal(rxnorm.coldChainFor('1049502').required, false);
  const unknown = rxnorm.coldChainFor('999999999');
  assert.equal(unknown.required, true);
  assert.equal(unknown.assumed, true);
});

test('the snapshot reports that it is illustrative', () => {
  const info = rxnorm.snapshotInfo();
  assert.equal(info.mode, 'offline-snapshot');
  assert.equal(info.illustrative, true);
  assert.ok(info.conceptCount >= 6);
});
