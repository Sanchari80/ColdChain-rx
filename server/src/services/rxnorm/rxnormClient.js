'use strict';

const config = require('../../config');
const { requestJson } = require('../../util/http');
const logger = require('../../util/logger');
const snapshot = require('./snapshot.json');
const { strengthFromComponents } = require('./strength');

/**
 * RxNorm lookups against the NIH / National Library of Medicine RxNav REST API.
 *
 * Drug identity is always resolved through RxCUI codes. Names are only ever
 * used as a fallback to *find* a code, never as the thing being compared —
 * "Lantus" and "Insulin Glargine 100 UNT/ML Injectable Solution" are the same
 * product and no amount of string matching will tell you that.
 */

const isLive = () => config.dataMode === 'live';

// Small in-process cache. RxNorm concepts are stable within a release, and
// RxNav asks callers to stay under ~20 requests/second.
const cache = new Map();
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;
let lastCallAt = 0;

function cached(key, producer) {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.value;
  const value = Promise.resolve()
    .then(producer)
    // A failed lookup must not be remembered as if it were an answer.
    .catch((err) => {
      cache.delete(key);
      throw err;
    });
  cache.set(key, { at: Date.now(), value });
  return value;
}

async function throttle() {
  const wait = config.rxnorm.minIntervalMs - (Date.now() - lastCallAt);
  if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
  lastCallAt = Date.now();
}

async function rxnav(path) {
  await throttle();
  return requestJson(`${config.rxnorm.baseUrl}${path}`, {
    headers: { Accept: 'application/json' },
    timeoutMs: config.rxnorm.timeoutMs,
    label: 'RxNav (NLM)',
  });
}

function normalize(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** Concept lookup by RxCUI. Returns null when the code is unknown. */
async function getConcept(rxcui) {
  if (!rxcui) return null;
  const key = `concept:${rxcui}`;

  if (!isLive()) {
    const local = snapshot.concepts[String(rxcui)];
    return local ? { ...local, source: snapshot.source } : null;
  }

  return cached(key, async () => {
    const props = await rxnav(`/rxcui/${encodeURIComponent(rxcui)}/properties.json`);
    if (!props || !props.properties) return null;
    const related = await rxnav(`/rxcui/${encodeURIComponent(rxcui)}/related.json?tty=IN+PIN+BN+DF+SCDC`);
    const groups = (related && related.relatedGroup && related.relatedGroup.conceptGroup) || [];
    const ingredients = [];
    const brands = [];
    const components = [];
    let doseForm = props.properties.doseFormName || null;
    for (const group of groups) {
      for (const concept of group.conceptProperties || []) {
        if (group.tty === 'BN') brands.push(concept.name);
        else if (group.tty === 'DF') doseForm = doseForm || concept.name;
        else if (group.tty === 'SCDC') components.push(concept.name);
        else ingredients.push({ rxcui: concept.rxcui, name: concept.name });
      }
    }
    return {
      rxcui: props.properties.rxcui,
      name: props.properties.name,
      tty: props.properties.tty,
      doseForm,
      strength: strengthFromComponents(components),
      ingredients,
      brands,
      source: 'rxnav-live',
    };
  });
}

/** Resolves a free-text drug description to an RxCUI. */
async function findByName(name) {
  const term = String(name || '').trim();
  if (!term) return null;

  if (!isLive()) {
    const target = normalize(term);
    for (const concept of Object.values(snapshot.concepts)) {
      if (normalize(concept.name) === target) return { ...concept, source: snapshot.source, matchType: 'exact' };
    }
    for (const concept of Object.values(snapshot.concepts)) {
      if ((concept.brands || []).some((brand) => normalize(brand) === target)) {
        return { ...concept, source: snapshot.source, matchType: 'brand' };
      }
    }
    return null;
  }

  return cached(`name:${normalize(term)}`, async () => {
    const exact = await rxnav(`/rxcui.json?name=${encodeURIComponent(term)}&search=2`);
    const ids = (exact && exact.idGroup && exact.idGroup.rxnormId) || [];
    if (ids.length) {
      const concept = await getConcept(ids[0]);
      return concept ? { ...concept, matchType: 'exact' } : null;
    }
    const approx = await rxnav(`/approximateTerm.json?term=${encodeURIComponent(term)}&maxEntries=1`);
    const candidate = approx && approx.approximateGroup && approx.approximateGroup.candidate;
    if (!candidate || !candidate.length) return null;
    const concept = await getConcept(candidate[0].rxcui);
    return concept ? { ...concept, matchType: 'approximate', score: Number(candidate[0].score) } : null;
  });
}

function ingredientKey(concept) {
  return (concept.ingredients || [])
    .map((ing) => ing.rxcui || normalize(ing.name))
    .sort()
    .join('|');
}

/**
 * Compares what the ward asked for against what the doctor actually prescribed.
 *
 * Returns a structured verdict instead of a boolean, because "different code,
 * same drug" and "different drug" are very different problems for a pharmacist.
 */
async function compare({ prescribedRxcui, prescribedName, requestedRxcui, requestedName }) {
  const findings = [];

  const prescribed = (await getConcept(prescribedRxcui)) || (await findByName(prescribedName));
  const requested = (await getConcept(requestedRxcui)) || (await findByName(requestedName));

  if (!prescribed) {
    findings.push({ severity: 'error', code: 'prescription-unresolvable', message: 'The prescribed medication could not be resolved in RxNorm.' });
    return { verdict: 'fail', prescribed: null, requested, findings };
  }
  if (!requested) {
    findings.push({ severity: 'error', code: 'request-unresolvable', message: 'The requested medication could not be resolved in RxNorm.' });
    return { verdict: 'fail', prescribed, requested: null, findings };
  }

  const sameConcept = String(prescribed.rxcui) === String(requested.rxcui);
  const sameIngredients = ingredientKey(prescribed) === ingredientKey(requested) && ingredientKey(prescribed) !== '';

  if (sameConcept) {
    findings.push({ severity: 'info', code: 'exact-match', message: `RxCUI ${prescribed.rxcui} matches the prescription exactly.` });
    return { verdict: 'pass', prescribed, requested, findings };
  }

  if (!sameIngredients) {
    findings.push({
      severity: 'error',
      code: 'ingredient-mismatch',
      message: `Different active ingredient. Prescribed ${prescribed.name}, requested ${requested.name}.`,
    });
    return { verdict: 'fail', prescribed, requested, findings };
  }

  // Same molecule, different product: strength or dose form differs.
  const strengthDiffers = JSON.stringify(prescribed.strength || null) !== JSON.stringify(requested.strength || null);
  const formDiffers = (prescribed.doseForm || null) !== (requested.doseForm || null);

  if (strengthDiffers) {
    findings.push({
      severity: 'error',
      code: 'strength-mismatch',
      message: `Same ingredient, different strength. Prescribed ${prescribed.name}, requested ${requested.name}.`,
    });
    return { verdict: 'fail', prescribed, requested, findings };
  }

  if (formDiffers) {
    findings.push({
      severity: 'warning',
      code: 'form-mismatch',
      message: `Same strength, different dose form (${prescribed.doseForm} vs ${requested.doseForm}). A pharmacist must approve the substitution.`,
    });
    return { verdict: 'review', prescribed, requested, findings };
  }

  findings.push({
    severity: 'warning',
    code: 'code-drift',
    message: `Codes differ (${prescribed.rxcui} vs ${requested.rxcui}) but resolve to the same product. Check the chart for a stale code.`,
  });
  return { verdict: 'review', prescribed, requested, findings };
}

function snapshotInfo() {
  return {
    mode: isLive() ? 'rxnav-live' : 'offline-snapshot',
    source: snapshot.source,
    generatedAt: snapshot.generatedAt,
    conceptCount: Object.keys(snapshot.concepts).length,
    // True only for hand-written demo codes. A snapshot pulled from RxNav holds real RxCUIs.
    illustrative: snapshot.source !== 'rxnav-live' && !isLive(),
  };
}

function coldChainFor(rxcui) {
  const concept = snapshot.concepts[String(rxcui)];
  if (concept && concept.coldChain) return concept.coldChain;
  // Unknown product: assume the refrigerated window and let a human confirm.
  logger.debug('rxnorm.coldchain.default', { rxcui });
  return { required: true, minCelsius: config.coldChain.minCelsius, maxCelsius: config.coldChain.maxCelsius, doNotFreeze: true, assumed: true };
}

module.exports = { getConcept, findByName, compare, snapshotInfo, coldChainFor, normalize };
