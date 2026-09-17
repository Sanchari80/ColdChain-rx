'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

process.env.LOG_LEVEL = 'silent';
const monitor = require('../src/services/coldchain/monitor');
const { meanKineticTemperature } = require('../src/services/coldchain/monitor');

test('mean kinetic temperature sits above the plain average', () => {
  const values = [2, 2, 2, 2, 20];
  const average = values.reduce((a, b) => a + b, 0) / values.length;
  const mkt = meanKineticTemperature(values);
  assert.ok(mkt > average, `${mkt} should exceed ${average}`);
});

test('a steady temperature gives back itself', () => {
  assert.ok(Math.abs(meanKineticTemperature([5, 5, 5, 5]) - 5) < 0.01);
});

test('a normal trip stays inside the window', () => {
  monitor.reset();
  monitor.startTrip({ indentId: 'TRIP-OK', minCelsius: 2, maxCelsius: 8 });
  for (let i = 0; i < 40; i += 1) monitor.sample('TRIP-OK');
  const summary = monitor.summary('TRIP-OK');
  assert.equal(summary.breached, false);
  assert.equal(summary.frozen, false);
  assert.equal(summary.sampleCount, 41);
});

test('a forced excursion is detected and timed', () => {
  monitor.reset();
  monitor.startTrip({ indentId: 'TRIP-WARM', minCelsius: 2, maxCelsius: 8, forceExcursion: true });
  for (let i = 0; i < 30; i += 1) monitor.sample('TRIP-WARM');
  const summary = monitor.summary('TRIP-WARM');
  assert.equal(summary.breached, true);
  assert.ok(summary.highestCelsius > 8);
  assert.ok(summary.approxMinutesOutOfRange > 0);
});

test('an explicit reading overrides the simulation', () => {
  monitor.reset();
  monitor.startTrip({ indentId: 'TRIP-PROBE', minCelsius: 2, maxCelsius: 8 });
  monitor.sample('TRIP-PROBE', -1.5);
  const summary = monitor.summary('TRIP-PROBE');
  assert.equal(summary.frozen, true);
  assert.equal(summary.breachedNow, true);
});

test('a closed trip stops accepting readings', () => {
  monitor.reset();
  monitor.startTrip({ indentId: 'TRIP-DONE', minCelsius: 2, maxCelsius: 8 });
  monitor.close('TRIP-DONE');
  assert.equal(monitor.sample('TRIP-DONE'), null);
  assert.equal(monitor.activeTripIds().length, 0);
});

test('the same indent replays identically', () => {
  monitor.reset();
  monitor.startTrip({ indentId: 'TRIP-SEED', minCelsius: 2, maxCelsius: 8 });
  for (let i = 0; i < 10; i += 1) monitor.sample('TRIP-SEED');
  const first = monitor.readings('TRIP-SEED').map((r) => r.celsius);

  monitor.reset();
  monitor.startTrip({ indentId: 'TRIP-SEED', minCelsius: 2, maxCelsius: 8 });
  for (let i = 0; i < 10; i += 1) monitor.sample('TRIP-SEED');
  const second = monitor.readings('TRIP-SEED').map((r) => r.celsius);

  assert.deepEqual(first, second);
});
