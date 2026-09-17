'use strict';

const { createHmac } = require('node:crypto');
const config = require('../../config');

/**
 * Outbound ward alerts must carry no Protected Health Information.
 *
 * Two layers, because one is not enough:
 *   1. Construction — the alert is *built* from a whitelist of operational
 *      fields. Nothing is copied wholesale from a chart and then filtered.
 *   2. Verification — `assertNoPhi` re-inspects the finished payload and throws
 *      if anything identifying survived. A future edit that adds a patient name
 *      to the alert fails loudly in tests instead of quietly in production.
 *
 * Reference: 45 CFR 164.514(b)(2), the Safe Harbor list of 18 identifiers.
 */

const IDENTIFIER_FIELDS = new Set([
  'name', 'given', 'family', 'prefix', 'suffix', 'patientName',
  'birthDate', 'dob', 'dateOfBirth', 'deceasedDateTime', 'admissionDate', 'dischargeDate',
  'mrn', 'medicalRecordNumber', 'ssn', 'nationalId', 'nid', 'insuranceNumber', 'accountNumber',
  'phone', 'telecom', 'mobile', 'fax', 'email',
  'address', 'addressLine', 'street', 'city', 'district', 'postalCode', 'zip',
  'photo', 'biometric', 'vehicleId', 'deviceSerial', 'ipAddress', 'url', 'licenseNumber',
]);

const PATTERNS = [
  { code: 'email', regex: /\b[\w.+-]+@[\w-]+\.[\w.-]{2,}\b/ },
  // Separators are stripped first, so "+880 1711 000001", "+8801711000001"
  // and "(880) 1711-000001" are all recognised as the same phone number.
  { code: 'phone', regex: /\+?\d{10,15}/, stripSeparators: true },
  { code: 'mrn', regex: /\bMRN[\s-]?\d{3,}\b/i },
  { code: 'ssn', regex: /\b\d{3}-\d{2}-\d{4}\b/ },
  { code: 'calendar-date', regex: /\b(19|20)\d{2}[-/](0?[1-9]|1[0-2])[-/](0?[1-9]|[12]\d|3[01])\b/ },
  { code: 'slashed-date', regex: /\b(0?[1-9]|[12]\d|3[01])[/](0?[1-9]|1[0-2])[/](19|20)\d{2}\b/ },
  { code: 'ip-address', regex: /\b(?:\d{1,3}\.){3}\d{1,3}\b/ },
];

// Fields whose values are operational timestamps or codes, not patient data.
// They are exempt from the date and number patterns.
const TIMESTAMP_FIELDS = new Set([
  'eta', 'etaIso', 'packedAt', 'preparedAt', 'dispatchedAt', 'deliveredAt',
  'generatedAt', 'recordedAt', 'createdAt', 'updatedAt', 'expiresAt', 'ts', 'sampledAt',
]);

/**
 * Stable, non-reversible pseudonym for a patient. Same patient, same token,
 * for the life of the deployment salt — enough for a nurse to correlate two
 * alerts, useless to anyone who intercepts them.
 */
function pseudonym(value, prefix = 'SUBJ') {
  const digest = createHmac('sha256', config.phi.pseudonymSalt).update(String(value)).digest('hex');
  return `${prefix}-${digest.slice(0, 10).toUpperCase()}`;
}

/** Recursively removes identifier-shaped keys. Used on anything logged or cached. */
function scrub(value, depth = 0) {
  if (depth > 8 || value === null || value === undefined) return value;
  if (Array.isArray(value)) return value.map((item) => scrub(item, depth + 1));
  if (typeof value !== 'object') return value;
  const out = {};
  for (const [key, child] of Object.entries(value)) {
    if (IDENTIFIER_FIELDS.has(key)) continue;
    out[key] = scrub(child, depth + 1);
  }
  return out;
}

function walkStrings(value, path, visit, depth = 0) {
  if (depth > 10 || value === null || value === undefined) return;
  if (typeof value === 'string') {
    visit(value, path);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => walkStrings(item, `${path}[${index}]`, visit, depth + 1));
    return;
  }
  if (typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) {
      walkStrings(child, path ? `${path}.${key}` : key, visit, depth + 1);
    }
  }
}

function normalizeForCompare(text) {
  return String(text).toLowerCase().replace(/[^a-z0-9]+/g, '');
}

/**
 * Inspects a finished payload for residual PHI.
 *
 * `knownValues` are the actual identifiers of the patient this payload is
 * about. Exact-value comparison catches what no regex can: a real name.
 */
function escapeRegex(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function buildNeedles(knownValues) {
  const needles = [];
  const seen = new Set();
  for (const raw of knownValues.flat()) {
    if (typeof raw !== 'string') continue;
    const value = raw.trim();
    if (value.length < 3 || seen.has(value.toLowerCase())) continue;
    seen.add(value.toLowerCase());
    const hasDigits = /\d/.test(value);
    if (hasDigits) {
      // Identifiers with digits are compared after stripping punctuation, so
      // "+880 1711 000001" still matches "+8801711000001".
      needles.push({ kind: 'normalized', value: normalizeForCompare(value) });
    } else {
      // Names are matched on word boundaries. A substring test would flag the
      // drug "Ramipril" for a patient called Ram.
      needles.push({ kind: 'word', regex: new RegExp(`\\b${escapeRegex(value)}\\b`, 'i') });
    }
  }
  // Short numeric identifiers (a 4-digit postcode, say) collide with room and
  // bed numbers, so only sufficiently distinctive digit strings become needles.
  return needles.filter((needle) => needle.kind !== 'normalized' || needle.value.length >= 6);
}

function findPhi(payload, knownValues = []) {
  const findings = [];
  const needles = buildNeedles(knownValues);

  walkStrings(payload, '', (text, path) => {
    const leaf = path.split('.').pop().replace(/\[\d+\]$/, '');
    const normalizedText = normalizeForCompare(text);

    for (const needle of needles) {
      const hit = needle.kind === 'word'
        ? needle.regex.test(text)
        : normalizedText.includes(needle.value);
      if (hit) {
        findings.push({ path, code: 'known-identifier', detail: 'a known patient identifier appears in the payload' });
        return;
      }
    }

    if (TIMESTAMP_FIELDS.has(leaf)) return;

    for (const pattern of PATTERNS) {
      const candidate = pattern.stripSeparators ? text.replace(/[\s\-().]/g, '') : text;
      if (pattern.regex.test(candidate)) {
        findings.push({ path, code: pattern.code, detail: `value matches the ${pattern.code} pattern` });
        return;
      }
    }
  });

  (function collectKeys(value, depth = 0) {
    if (depth > 10 || !value || typeof value !== 'object') return;
    if (Array.isArray(value)) {
      value.forEach((item) => collectKeys(item, depth + 1));
      return;
    }
    for (const [key, child] of Object.entries(value)) {
      if (IDENTIFIER_FIELDS.has(key)) {
        findings.push({ path: key, code: 'identifier-field', detail: `field "${key}" is a Safe Harbor identifier` });
      }
      collectKeys(child, depth + 1);
    }
  })(payload);

  return findings;
}

class PhiLeakError extends Error {
  constructor(findings) {
    super(`Outbound payload blocked: ${findings.length} possible PHI leak(s)`);
    this.name = 'PhiLeakError';
    this.status = 500;
    this.code = 'phi_leak_blocked';
    this.findings = findings;
  }
}

function assertNoPhi(payload, knownValues = []) {
  const findings = findPhi(payload, knownValues);
  if (findings.length) throw new PhiLeakError(findings);
  return payload;
}

/**
 * Builds the alert that lands on the ward phone.
 *
 * Everything here answers a nurse's question — what is coming, who is bringing
 * it, when does it arrive, is it still cold. None of it answers "who is the
 * patient", which the nurse already knows from the bed they are standing next to.
 */
function buildWardAlert({ indent, courier, etaIso, drugDisplay, doseSummary, coldChain, status, bed, ward, severity = 'info' }) {
  const alert = {
    indentId: indent.id,
    subjectToken: pseudonym(indent.patientId),
    ward,
    bed,
    drug: drugDisplay,
    dose: doseSummary,
    status,
    severity,
    // Staff names are not PHI and are shown on purpose: the nurse needs to know
    // who to expect at the door. The field is called staffName rather than name
    // so that a bare `name` key anywhere in an outbound alert stays a hard fail.
    courier: { id: courier.id, staffName: courier.name, role: courier.role },
    eta: etaIso,
    coldChain: {
      minCelsius: coldChain.minCelsius,
      maxCelsius: coldChain.maxCelsius,
      currentCelsius: coldChain.currentCelsius ?? null,
      breached: Boolean(coldChain.breached),
    },
    notice: 'Patient details are intentionally omitted. Open the chart to confirm identity at the bedside.',
  };
  return alert;
}

/** Collects every identifier this service holds about a patient, for the guard. */
function knownIdentifiersOf(patient, hl7Patient) {
  const values = [];
  const push = (value) => { if (value) values.push(String(value)); };

  for (const entry of patient?.name || []) {
    push(entry.family);
    for (const given of entry.given || []) push(given);
    push(entry.text);
  }
  push(patient?.birthDate);
  for (const identifier of patient?.identifier || []) push(identifier.value);
  for (const contact of patient?.telecom || []) push(contact.value);
  for (const address of patient?.address || []) {
    for (const line of address.line || []) push(line);
    push(address.postalCode);
  }

  if (hl7Patient) {
    push(hl7Patient.mrn);
    push(hl7Patient.family);
    push(hl7Patient.given);
    push(hl7Patient.phone);
    push(hl7Patient.addressLine);
    if (hl7Patient.birthDate) push(String(hl7Patient.birthDate).slice(0, 10));
  }

  return values;
}

module.exports = {
  pseudonym,
  scrub,
  findPhi,
  assertNoPhi,
  buildWardAlert,
  knownIdentifiersOf,
  PhiLeakError,
  IDENTIFIER_FIELDS,
};
