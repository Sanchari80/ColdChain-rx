'use strict';

/**
 * Strength of an RxNorm clinical drug, read from its SCDC components.
 *
 * RxNorm does not publish strength as a separate field. It models it as the
 * Semantic Clinical Drug Component (SCDC): one concept per ingredient, named
 * "<ingredient> <amount> <unit>", e.g. "insulin glargine 300 UNT/ML". Those
 * component concepts come from the RxNorm relationship graph, so this reads
 * structured terminology rather than guessing from a free-text product name.
 */

const COMPONENT = /^(.*\S)\s+(\d+(?:\.\d+)?)\s+(\S+)$/;

/** "insulin glargine 300 UNT/ML" -> { ingredient, value: 300, unit: 'UNT/ML' } */
function parseComponent(name) {
  const match = COMPONENT.exec(String(name || '').trim());
  if (!match) return null;
  return { ingredient: match[1].toLowerCase(), value: Number(match[2]), unit: match[3].toUpperCase() };
}

/** Strength of a product as a stable, comparable list, one entry per ingredient. */
function strengthFromComponents(componentNames) {
  const parts = (componentNames || []).map(parseComponent).filter(Boolean);
  if (!parts.length) return null;
  return parts.sort((a, b) => a.ingredient.localeCompare(b.ingredient));
}

module.exports = { parseComponent, strengthFromComponents };
