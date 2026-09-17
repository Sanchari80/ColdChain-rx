'use strict';

const config = require('../../config');

/**
 * Tracks the temperature of a medicine while it is in transit from the pharmacy
 * fridge to the ward.
 *
 * A refrigerated product is not judged by its temperature right now but by the
 * whole journey: how long it spent outside 2-8 C and how hot it got. Mean
 * kinetic temperature (MKT) is the standard way to express that as one number —
 * it weights time spent warm much more heavily than a simple average does.
 */

const GAS_CONSTANT = 0.0083144621; // kJ / (mol * K)
const ACTIVATION_ENERGY = 83.144; // kJ / mol, the value conventionally used for MKT

/** Deterministic PRNG so a demo replays identically. */
function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function seedFrom(text) {
  let hash = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function meanKineticTemperature(celsiusValues) {
  if (!celsiusValues.length) return null;
  const kelvin = celsiusValues.map((c) => c + 273.15);
  const sum = kelvin.reduce((acc, k) => acc + Math.exp(-ACTIVATION_ENERGY / (GAS_CONSTANT * k)), 0);
  const mean = sum / kelvin.length;
  const mkt = -ACTIVATION_ENERGY / (GAS_CONSTANT * Math.log(mean));
  return Number((mkt - 273.15).toFixed(2));
}

class ColdChainMonitor {
  constructor() {
    /** @type {Map<string, object>} */
    this.trips = new Map();
  }

  reset() {
    this.trips.clear();
  }

  /**
   * @param {object} options
   * @param {string} options.indentId
   * @param {number} options.minCelsius
   * @param {number} options.maxCelsius
   * @param {boolean} [options.forceExcursion] seeds a journey that goes warm
   */
  startTrip({ indentId, minCelsius, maxCelsius, startCelsius, forceExcursion = false }) {
    const min = Number.isFinite(minCelsius) ? minCelsius : config.coldChain.minCelsius;
    const max = Number.isFinite(maxCelsius) ? maxCelsius : config.coldChain.maxCelsius;
    const random = mulberry32(seedFrom(indentId));
    const initial = Number.isFinite(startCelsius) ? startCelsius : Number((min + (max - min) * 0.45).toFixed(2));

    const trip = {
      indentId,
      minCelsius: min,
      maxCelsius: max,
      startedAt: new Date().toISOString(),
      readings: [{ ts: new Date().toISOString(), celsius: initial }],
      random,
      forceExcursion,
      closedAt: null,
    };
    this.trips.set(indentId, trip);
    return this.summary(indentId);
  }

  /** Appends one simulated probe reading. Real deployments feed sensor data here. */
  sample(indentId, celsius, atIso) {
    const trip = this.trips.get(indentId);
    if (!trip || trip.closedAt) return null;

    let next = celsius;
    if (!Number.isFinite(next)) {
      const last = trip.readings[trip.readings.length - 1].celsius;
      const drift = (trip.random() - 0.38) * 0.7;
      const pull = trip.forceExcursion ? 0.55 : -0.05 * (last - (trip.minCelsius + trip.maxCelsius) / 2);
      next = Number((last + drift + pull).toFixed(2));
      if (!trip.forceExcursion) {
        next = Math.min(Math.max(next, trip.minCelsius - 0.6), trip.maxCelsius + 0.4);
      }
    }

    trip.readings.push({ ts: atIso || new Date().toISOString(), celsius: Number(next.toFixed(2)) });
    if (trip.readings.length > 240) trip.readings.shift();
    return this.summary(indentId);
  }

  close(indentId) {
    const trip = this.trips.get(indentId);
    if (trip && !trip.closedAt) trip.closedAt = new Date().toISOString();
    return this.summary(indentId);
  }

  readings(indentId, limit = 60) {
    const trip = this.trips.get(indentId);
    if (!trip) return [];
    return trip.readings.slice(-limit);
  }

  summary(indentId) {
    const trip = this.trips.get(indentId);
    if (!trip) return null;

    const values = trip.readings.map((r) => r.celsius);
    const current = values[values.length - 1];
    const outside = trip.readings.filter((r) => r.celsius < trip.minCelsius || r.celsius > trip.maxCelsius);
    const sampleSeconds = config.coldChain.sampleSeconds;

    return {
      indentId,
      minCelsius: trip.minCelsius,
      maxCelsius: trip.maxCelsius,
      currentCelsius: current,
      lowestCelsius: Math.min(...values),
      highestCelsius: Math.max(...values),
      meanKineticCelsius: meanKineticTemperature(values),
      breached: outside.length > 0,
      breachedNow: current < trip.minCelsius || current > trip.maxCelsius,
      breachSamples: outside.length,
      approxMinutesOutOfRange: Number(((outside.length * sampleSeconds) / 60).toFixed(1)),
      frozen: values.some((v) => v <= 0),
      startedAt: trip.startedAt,
      closedAt: trip.closedAt,
      sampleCount: values.length,
    };
  }

  activeTripIds() {
    return [...this.trips.values()].filter((t) => !t.closedAt).map((t) => t.indentId);
  }
}

module.exports = new ColdChainMonitor();
module.exports.ColdChainMonitor = ColdChainMonitor;
module.exports.meanKineticTemperature = meanKineticTemperature;
