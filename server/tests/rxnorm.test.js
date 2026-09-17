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
  const result = await rxnorm.compare({ prescribedRxcui: '311041', requestedRxcui: '2002419' });
  assert.equal(result.verdict, 'fail');
  assert.ok(result.findings.some((f) => f.code === 'strength-mismatch'));
});

test('a different ingredient fails', async () => {
  const result = await rxnorm.compare({ prescribedRxcui: '311041', requestedRxcui: '311040' });
  assert.equal(result.verdict, 'fail');
  assert.ok(result.findings.some((f) => f.code === 'ingredient-mismatch'));
});

test('same strength in a different dose form needs a pharmacist', async () => {
  const result = await rxnorm.compare({ prescribedRxcui: '311041', requestedRxcui: '847230' });
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
  assert.equal(rxnorm.coldChainFor('313782').required, false);
  const unknown = rxnorm.coldChainFor('999999999');
  assert.equal(unknown.required, true);
  assert.equal(unknown.assumed, true);
});

test('the offline formulary is real RxNorm data pulled from RxNav', () => {
  const info = rxnorm.snapshotInfo();
  assert.equal(info.mode, 'offline-snapshot');
  assert.equal(info.source, 'rxnav-live');
  assert.equal(info.illustrative, false);
  assert.ok(info.conceptCount >= 7);
});

test('strength is read from RxNorm drug components, not from the product name', () => {
  const { parseComponent, strengthFromComponents } = require('../src/services/rxnorm/strength');
  assert.deepEqual(parseComponent('insulin glargine 300 UNT/ML'), { ingredient: 'insulin glargine', value: 300, unit: 'UNT/ML' });
  assert.deepEqual(parseComponent('filgrastim 0.6 MG/ML'), { ingredient: 'filgrastim', value: 0.6, unit: 'MG/ML' });
  assert.equal(strengthFromComponents([]), null);
  // Combination products compare the same whatever order RxNav lists them in.
  assert.deepEqual(
    strengthFromComponents(['lixisenatide 0.033 MG/ML', 'insulin glargine 100 UNT/ML']),
    strengthFromComponents(['insulin glargine 100 UNT/ML', 'lixisenatide 0.033 MG/ML']),
  );
});
