#!/usr/bin/env node
'use strict';

/**
 * Replaces the bundled offline RxNorm snapshot with live data from the NIH /
 * National Library of Medicine RxNav REST API.
 *
 * Run it with internet access to rebuild the formulary the service checks
 * against when it is not calling RxNav live:
 *
 *   npm run rxnorm:refresh
 *
 * RxNav is public and needs no key. It asks callers to stay under roughly
 * 20 requests a second, so this walks the list slowly and deliberately.
 */

const fs = require('node:fs');
const path = require('node:path');
const { strengthFromComponents } = require('../src/services/rxnorm/strength');

const BASE = process.env.RXNAV_BASE_URL || 'https://rxnav.nlm.nih.gov/REST';
const SNAPSHOT = path.resolve(__dirname, '..', 'src', 'services', 'rxnorm', 'snapshot.json');
const GAP_MS = 120;

// The products this demo dispenses, plus the near-misses the safety gate has to
// tell apart. Listed by RxCUI so the formulary never depends on how a name is
// spelled; the names are only there for whoever reads this file.
const WANTED = [
  { rxcui: '311041', label: 'insulin glargine 100 UNT/ML Injectable Solution', coldChain: true },
  { rxcui: '2002419', label: 'insulin glargine 300 UNT/ML Pen Injector (wrong strength)', coldChain: true },
  { rxcui: '847230', label: 'insulin glargine 100 UNT/ML Pen Injector (wrong form)', coldChain: true },
  { rxcui: '727535', label: 'filgrastim 0.6 MG/ML Prefilled Syringe', coldChain: true },
  { rxcui: '727703', label: 'adalimumab 50 MG/ML Prefilled Syringe', coldChain: true },
  { rxcui: '311040', label: 'insulin aspart 100 UNT/ML Injectable Solution', coldChain: true },
  { rxcui: '313782', label: 'acetaminophen 325 MG Oral Tablet (not refrigerated)', coldChain: false },
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

async function describe(rxcui) {
  const props = await get(`/rxcui/${rxcui}/properties.json`);
  if (!props?.properties) return null;

  const related = await get(`/rxcui/${rxcui}/related.json?tty=IN+PIN+BN+DF+SCDC`);
  const groups = related?.relatedGroup?.conceptGroup || [];
  const ingredients = [];
  const brands = [];
  const components = [];
  let doseForm = null;

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
  };
}

async function main() {
  const concepts = {};
  const failed = [];

  for (const wanted of WANTED) {
    process.stdout.write(`${wanted.rxcui} ${wanted.label} ... `);
    try {
      const concept = await describe(wanted.rxcui);
      if (!concept) {
        console.log('not in RxNorm');
        failed.push(wanted.rxcui);
        continue;
      }
      concepts[concept.rxcui] = {
        ...concept,
        coldChain: wanted.coldChain
          ? { required: true, minCelsius: 2, maxCelsius: 8, doNotFreeze: true }
          : { required: false },
      };
      console.log(`${concept.name} [${(concept.strength || []).map((s) => `${s.value} ${s.unit}`).join(', ') || 'no strength'}]`);
    } catch (err) {
      console.log(`failed (${err.message})`);
      failed.push(wanted.rxcui);
    }
  }

  // All or nothing: a half-refreshed formulary would make the safety gate
  // disagree with itself.
  if (failed.length) {
    console.error(`
Could not refresh ${failed.join(', ')}. The snapshot has been left untouched.`);
    process.exit(1);
  }

  const snapshot = {
    source: 'rxnav-live',
    generatedAt: new Date().toISOString(),
    note: `Pulled from ${BASE}. Regenerate with npm run rxnorm:refresh.`,
    concepts,
  };

  fs.writeFileSync(SNAPSHOT, `${JSON.stringify(snapshot, null, 2)}
`);
  console.log(`
Wrote ${Object.keys(concepts).length} concepts to ${path.relative(process.cwd(), SNAPSHOT)}`);
}

main().catch((err) => {
  console.error(`\nRefresh failed: ${err.message}`);
  console.error('The existing snapshot has been left untouched.');
  process.exit(1);
});
