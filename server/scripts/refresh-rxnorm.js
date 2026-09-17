#!/usr/bin/env node
'use strict';

/**
 * Replaces the bundled offline RxNorm snapshot with live data from the NIH /
 * National Library of Medicine RxNav REST API.
 *
 * Run this once with internet access and the demo stops relying on the
 * illustrative codes shipped in the repository:
 *
 *   npm run rxnorm:refresh
 *
 * RxNav is public and needs no key. It asks callers to stay under roughly
 * 20 requests a second, so this walks the list slowly and deliberately.
 */

const fs = require('node:fs');
const path = require('node:path');

const BASE = process.env.RXNAV_BASE_URL || 'https://rxnav.nlm.nih.gov/REST';
const SNAPSHOT = path.resolve(__dirname, '..', 'src', 'services', 'rxnorm', 'snapshot.json');
const GAP_MS = 120;

// The products this demo dispenses, plus the near-misses the safety gate has to
// tell apart. Add to this list to widen the offline formulary.
const WANTED = [
  { name: 'Insulin Glargine 100 UNT/ML Injectable Solution', coldChain: true },
  { name: 'Insulin Glargine 300 UNT/ML Injectable Solution', coldChain: true },
  { name: 'Insulin Glargine 100 UNT/ML Pen Injector', coldChain: true },
  { name: 'Filgrastim 300 MCG/0.5ML Injection', coldChain: true },
  { name: 'Adalimumab 40 MG/0.8ML Prefilled Syringe', coldChain: true },
  { name: 'Insulin Aspart 100 UNT/ML Injectable Solution', coldChain: true },
  { name: 'Acetaminophen 325 MG Oral Tablet', coldChain: false },
];

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function get(pathname) {
  await sleep(GAP_MS);
  const response = await fetch(`${BASE}${pathname}`, {
    headers: { Accept: 'application/json' },
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) throw new Error(`RxNav returned ${response.status} for ${pathname}`);
  return response.json();
}

async function resolve(name) {
  const exact = await get(`/rxcui.json?name=${encodeURIComponent(name)}&search=2`);
  const ids = exact?.idGroup?.rxnormId || [];
  if (ids.length) return ids[0];

  const approx = await get(`/approximateTerm.json?term=${encodeURIComponent(name)}&maxEntries=1`);
  const candidate = approx?.approximateGroup?.candidate?.[0];
  return candidate ? candidate.rxcui : null;
}

async function describe(rxcui) {
  const props = await get(`/rxcui/${rxcui}/properties.json`);
  if (!props?.properties) return null;

  const related = await get(`/rxcui/${rxcui}/related.json?tty=IN+PIN+BN+DF`);
  const groups = related?.relatedGroup?.conceptGroup || [];
  const ingredients = [];
  const brands = [];
  let doseForm = null;

  for (const group of groups) {
    for (const concept of group.conceptProperties || []) {
      if (group.tty === 'BN') brands.push(concept.name);
      else if (group.tty === 'DF') doseForm = doseForm || concept.name;
      else ingredients.push({ rxcui: concept.rxcui, name: concept.name });
    }
  }

  return {
    rxcui: props.properties.rxcui,
    name: props.properties.name,
    tty: props.properties.tty,
    doseForm,
    ingredients,
    brands,
  };
}

async function main() {
  const concepts = {};
  const failed = [];

  for (const wanted of WANTED) {
    process.stdout.write(`resolving ${wanted.name} ... `);
    try {
      const rxcui = await resolve(wanted.name);
      if (!rxcui) {
        console.log('not found');
        failed.push(wanted.name);
        continue;
      }
      const concept = await describe(rxcui);
      if (!concept) {
        console.log('no properties');
        failed.push(wanted.name);
        continue;
      }
      concepts[rxcui] = {
        ...concept,
        coldChain: wanted.coldChain
          ? { required: true, minCelsius: 2, maxCelsius: 8, doNotFreeze: true }
          : { required: false },
      };
      console.log(`RxCUI ${rxcui}`);
    } catch (err) {
      console.log(`failed (${err.message})`);
      failed.push(wanted.name);
    }
  }

  if (!Object.keys(concepts).length) {
    console.error('\nNothing was resolved. The snapshot has been left untouched.');
    process.exit(1);
  }

  const previous = JSON.parse(fs.readFileSync(SNAPSHOT, 'utf8'));
  // Keep any strengths that were hand-written: RxNav exposes the strength
  // inside the concept name rather than as its own field.
  for (const [rxcui, concept] of Object.entries(concepts)) {
    const old = previous.concepts[rxcui];
    if (old && old.strength) concept.strength = old.strength;
  }

  const snapshot = {
    source: 'rxnav-live',
    generatedAt: new Date().toISOString(),
    note: `Pulled from ${BASE}. Regenerate with npm run rxnorm:refresh.`,
    concepts,
  };

  fs.writeFileSync(SNAPSHOT, `${JSON.stringify(snapshot, null, 2)}\n`);
  console.log(`\nWrote ${Object.keys(concepts).length} concepts to ${path.relative(process.cwd(), SNAPSHOT)}`);
  if (failed.length) console.log(`Could not resolve: ${failed.join(', ')}`);
}

main().catch((err) => {
  console.error(`\nRefresh failed: ${err.message}`);
  console.error('The existing snapshot has been left untouched.');
  process.exit(1);
});
