'use strict';

const { randomUUID } = require('node:crypto');
const config = require('../../config');
const fhir = require('../fhir/fhirClient');
const { buildMedicationDispense, buildProvenance, OUTCOME } = require('../fhir/resources');
const rxnorm = require('../rxnorm/rxnormClient');
const hl7 = require('../hl7/omp09');
const { samples, ompO09, escapeText } = require('../hl7/samples');
const phi = require('../phi/deidentify');
const coldChain = require('../coldchain/monitor');
const notifications = require('../notifications/store');
const push = require('../notifications/push');
const audit = require('../audit/auditService');
const { badRequest, notFound, conflict, forbidden } = require('../../util/errors');
const logger = require('../../util/logger');

/**
 * The ward indent lifecycle.
 *
 *   requested -> verified | blocked -> packed -> in-transit -> delivered
 *
 * Nothing moves to `packed` without a passing safety verification, and every
 * transition writes an AuditEvent before it returns.
 */

const STATUS = {
  REQUESTED: 'requested',
  VERIFIED: 'verified',
  BLOCKED: 'blocked',
  PACKED: 'packed',
  IN_TRANSIT: 'in-transit',
  DELIVERED: 'delivered',
  CANCELLED: 'cancelled',
};

const COURIERS = [
  { id: 'CUR-01', name: 'Rakib Mia', role: 'Pharmacy porter' },
  { id: 'CUR-02', name: 'Shila Akter', role: 'Pharmacy technician' },
  { id: 'CUR-03', name: 'Jamal Uddin', role: 'Pharmacy porter' },
  { id: 'CUR-04', name: 'Transport unit T-3', role: 'Autonomous trolley' },
];

// Walking minutes from the Level 2 pharmacy to each ward, used for the ETA.
const WARD_TRANSIT_MINUTES = { 'IPD-7B': 9, 'IPD-9A': 13, 'ICU-3': 6, default: 11 };

const indents = new Map();

function transitMinutesFor(ward) {
  return WARD_TRANSIT_MINUTES[ward] ?? WARD_TRANSIT_MINUTES.default;
}

function pickCourier(indentId) {
  let hash = 0;
  for (let i = 0; i < indentId.length; i += 1) hash = (hash * 31 + indentId.charCodeAt(i)) >>> 0;
  return COURIERS[hash % COURIERS.length];
}

function doseSummaryOf(prescription) {
  const dosage = prescription?.dosageInstruction?.[0];
  if (!dosage) return null;
  if (dosage.text) return dosage.text;
  const dose = dosage.doseAndRate?.[0]?.doseQuantity;
  return dose ? `${dose.value} ${dose.unit}` : null;
}

function referenceIdOf(reference) {
  if (!reference) return null;
  const value = typeof reference === 'string' ? reference : reference.reference;
  return value ? value.split('/').pop() : null;
}

function publicView(indent) {
  // What the mobile app is allowed to see. Staff names are fine; patient
  // identity is reduced to a pseudonym and the bed the nurse is standing at.
  return {
    id: indent.id,
    status: indent.status,
    createdAt: indent.createdAt,
    updatedAt: indent.updatedAt,
    ward: indent.ward,
    room: indent.room,
    bed: indent.bed,
    bedLabel: [indent.ward, indent.room && indent.bed ? `${indent.room}-${indent.bed}` : indent.room].filter(Boolean).join(' / '),
    subjectToken: phi.pseudonym(indent.patientId),
    prescriptionId: indent.prescriptionId,
    priority: indent.priority,
    requestedBy: indent.requestedBy,
    drug: indent.requestedDrug,
    dose: indent.doseSummary,
    coldChain: indent.coldChainSpec,
    verification: indent.verification,
    hl7: indent.hl7 ? { messageControlId: indent.hl7.messageControlId, receivedAt: indent.hl7.receivedAt, segments: indent.hl7.segments } : null,
    delivery: indent.delivery,
    telemetry: coldChain.summary(indent.id),
    blockedReason: indent.blockedReason || null,
  };
}

function requireIndent(id) {
  const indent = indents.get(id);
  if (!indent) throw notFound(`Indent ${id} does not exist`);
  return indent;
}

function touch(indent) {
  indent.updatedAt = new Date().toISOString();
  return indent;
}

/** Creates an indent from an already-parsed OMP^O09 message. */
async function upsertFromHl7(parsed, actor, sourceIp) {
  const indentId = parsed.order.placerOrderNumber;
  const item = parsed.items[0];

  // Resolve the patient from the MRN carried in PID-3 rather than trusting any
  // identifier supplied by the caller.
  const matches = await fhir.search('Patient', { identifier: parsed.patient.mrn });
  const patient = matches[0] || null;
  if (!patient) {
    throw notFound(`No patient on the FHIR server carries MRN ${parsed.patient.mrn ? '(redacted)' : '(missing)'}`);
  }

  const activeRequests = await fhir.activeMedicationRequestsFor(patient.id);
  const allRequests = await fhir.search('MedicationRequest', { patient: patient.id });
  const prescription = activeRequests.find((request) => request.medicationCodeableConcept?.coding?.some((c) => c.code === item.code))
    || allRequests.find((request) => request.medicationCodeableConcept?.coding?.some((c) => c.code === item.code))
    || activeRequests[0]
    || allRequests[0]
    || null;

  const existing = indents.get(indentId);
  const indent = existing || {
    id: indentId,
    createdAt: new Date().toISOString(),
    status: STATUS.REQUESTED,
    alerts: [],
  };

  Object.assign(indent, {
    patientId: patient.id,
    patientRef: `Patient/${patient.id}`,
    encounterRef: prescription?.encounter?.reference || null,
    ward: parsed.visit.ward,
    room: parsed.visit.room,
    bed: parsed.visit.bed,
    priority: parsed.order.quantityTiming.priority === 'S' ? 'stat' : 'routine',
    prescriptionId: prescription ? prescription.id : null,
    requestedBy: {
      id: parsed.order.enteredBy.id,
      name: [parsed.order.enteredBy.given, parsed.order.enteredBy.family].filter(Boolean).join(' ') || 'Ward staff',
      role: 'Nurse',
    },
    requestedDrug: {
      rxcui: item.code,
      display: item.display,
      codeSystem: item.codeSystem,
      dispenseQuantity: item.dispenseAmount,
      dispenseUnits: item.dispenseUnits,
      route: item.route ? item.route.display : null,
    },
    doseSummary: item.amountMinimum !== null ? `${item.amountMinimum} ${item.unitsDisplay || item.units || ''}`.trim() : null,
    coldChainSpec: rxnorm.coldChainFor(item.code),
    notes: parsed.notes,
    hl7: {
      messageControlId: parsed.header.messageControlId,
      receivedAt: new Date().toISOString(),
      segments: parsed.segments,
    },
    // PHI extracted from PID stays server-side and is never returned by the API.
    _phi: parsed.patient,
  });

  touch(indent);
  indents.set(indentId, indent);

  await audit.record({
    action: 'C',
    subtypeCode: 'create',
    subtypeDisplay: 'HL7 v2 OMP^O09 ingested',
    actor,
    sourceIp,
    patientRef: indent.patientRef,
    entities: [{ reference: `MedicationRequest/${indent.prescriptionId}`, name: 'Prescription referenced by indent' }],
    summary: `Indent ${indent.id} created from HL7 message ${parsed.header.messageControlId}`,
  });

  return indent;
}

/** Reads the prescription and runs the full safety gate. */
async function verify(indentId, actor, sourceIp) {
  const indent = requireIndent(indentId);
  if ([STATUS.DELIVERED, STATUS.CANCELLED].includes(indent.status)) {
    throw conflict(`Indent ${indentId} is ${indent.status} and cannot be re-verified`);
  }
  if (!indent.prescriptionId) {
    throw conflict('This indent is not linked to a prescription, so it cannot be verified');
  }

  const prescription = await fhir.getMedicationRequest(indent.prescriptionId);

  await audit.record({
    action: 'R',
    subtypeCode: 'read',
    subtypeDisplay: 'MedicationRequest read for verification',
    actor,
    sourceIp,
    patientRef: indent.patientRef,
    entities: [{ reference: `MedicationRequest/${prescription.id}`, name: 'Prescription under verification' }],
    summary: `Prescription ${prescription.id} read while verifying indent ${indent.id}`,
  });

  const checks = [];
  const add = (code, severity, label, message) => checks.push({ code, severity, label, message });

  // 1. The order still stands.
  if (prescription.status === 'active') {
    add('prescription-active', 'pass', 'Prescription is active', 'The doctor\'s order is still in force.');
  } else {
    add('prescription-not-active', 'fail', 'Prescription is not active', `The order status is "${prescription.status}". A stopped or completed order must not be dispensed.`);
  }

  // 2. The order belongs to this bed's patient.
  const prescriptionPatient = referenceIdOf(prescription.subject);
  if (prescriptionPatient === indent.patientId) {
    add('patient-match', 'pass', 'Patient matches', 'The prescription belongs to the patient in this bed.');
  } else {
    add('patient-mismatch', 'fail', 'Wrong patient', 'The prescription is written for a different patient than the indent.');
  }

  // 3. The order has not run out.
  const validity = prescription.dispenseRequest?.validityPeriod;
  if (validity?.end) {
    const expired = new Date(`${validity.end}T23:59:59Z`) < new Date();
    add(expired ? 'prescription-expired' : 'prescription-in-window', expired ? 'fail' : 'pass',
      expired ? 'Prescription window has closed' : 'Prescription is inside its valid window',
      expired ? `Valid until ${validity.end}. Ask the prescriber to renew it.` : `Valid ${validity.start} to ${validity.end}.`);
  }

  // 4. The drug itself, by code and not by name.
  const prescribedCoding = prescription.medicationCodeableConcept?.coding?.[0];
  const comparison = await rxnorm.compare({
    prescribedRxcui: prescribedCoding?.code,
    prescribedName: prescription.medicationCodeableConcept?.text || prescribedCoding?.display,
    requestedRxcui: indent.requestedDrug.rxcui,
    requestedName: indent.requestedDrug.display,
  });
  for (const finding of comparison.findings) {
    add(
      finding.code,
      finding.severity === 'error' ? 'fail' : finding.severity === 'warning' ? 'warn' : 'pass',
      finding.code === 'exact-match' ? 'Drug matches the prescription' : 'Drug does not match cleanly',
      finding.message,
    );
  }

  // 5. Has this already gone out today?
  const previousDispenses = await fhir.dispensesForPrescription(prescription.id);
  const recent = previousDispenses.filter((dispense) => {
    const when = dispense.whenPrepared || dispense.meta?.lastUpdated;
    return when && Date.now() - new Date(when).getTime() < 12 * 60 * 60 * 1000;
  });
  if (recent.length) {
    add('possible-duplicate', 'warn', 'Already dispensed recently', `${recent.length} dispense(s) for this order in the last 12 hours. Confirm the dose is due before packing another.`);
  } else {
    add('no-duplicate', 'pass', 'No recent duplicate', 'Nothing has been dispensed against this order in the last 12 hours.');
  }

  // 6. Cold chain expectations.
  const spec = rxnorm.coldChainFor(indent.requestedDrug.rxcui);
  if (spec.required) {
    add('cold-chain-required', spec.assumed ? 'warn' : 'pass',
      'Refrigerated product',
      spec.assumed
        ? 'This product is not in the local cold-chain list, so the 2-8 C window is assumed. Confirm with the package insert.'
        : `Keep between ${spec.minCelsius} C and ${spec.maxCelsius} C. Do not freeze.`);
  }

  const failed = checks.filter((check) => check.severity === 'fail');
  const warned = checks.filter((check) => check.severity === 'warn');
  const verdict = failed.length ? 'fail' : warned.length ? 'review' : 'pass';

  indent.verification = {
    verdict,
    checkedAt: new Date().toISOString(),
    checkedBy: { id: actor.id, name: actor.name, role: actor.role },
    checks,
    rxnorm: {
      prescribed: comparison.prescribed && { rxcui: comparison.prescribed.rxcui, name: comparison.prescribed.name, ingredients: comparison.prescribed.ingredients, brands: comparison.prescribed.brands },
      requested: comparison.requested && { rxcui: comparison.requested.rxcui, name: comparison.requested.name, ingredients: comparison.requested.ingredients, brands: comparison.requested.brands },
      source: rxnorm.snapshotInfo(),
    },
    prescription: {
      id: prescription.id,
      status: prescription.status,
      display: prescription.medicationCodeableConcept?.text || prescribedCoding?.display,
      rxcui: prescribedCoding?.code,
      dose: doseSummaryOf(prescription),
      authoredOn: prescription.authoredOn,
      prescriberRef: prescription.requester?.reference || null,
    },
  };

  indent.status = verdict === 'fail' ? STATUS.BLOCKED : STATUS.VERIFIED;
  indent.blockedReason = verdict === 'fail' ? failed[0].message : null;
  touch(indent);

  await audit.record({
    action: 'E',
    subtypeCode: 'operation',
    subtypeDisplay: 'Pharmacy safety verification executed',
    outcome: verdict === 'fail' ? OUTCOME.minorFailure : OUTCOME.success,
    outcomeDesc: verdict === 'fail' ? indent.blockedReason : undefined,
    actor,
    sourceIp,
    patientRef: indent.patientRef,
    entities: [{ reference: `MedicationRequest/${prescription.id}`, name: 'Prescription verified' }],
    summary: `Verification of indent ${indent.id} returned "${verdict}"`,
  });

  if (verdict === 'fail') {
    await publishAlert(indent, {
      status: 'blocked',
      severity: 'critical',
      courier: { id: '-', name: 'Not dispatched', role: 'Blocked at pharmacy' },
      etaIso: null,
      telemetry: { minCelsius: indent.coldChainSpec.minCelsius, maxCelsius: indent.coldChainSpec.maxCelsius },
      actor,
    });
  }

  return indent;
}

/** Packs the drug, writes MedicationDispense, and puts it on the road. */
async function dispense(indentId, { courierId, overrideReason, forceExcursion = false }, actor, sourceIp) {
  const indent = requireIndent(indentId);

  if (!indent.verification) {
    throw conflict('Verify the indent against the prescription before packing it');
  }
  if (indent.verification.verdict === 'fail') {
    throw forbidden(`This indent is blocked: ${indent.blockedReason}`);
  }
  if (indent.verification.verdict === 'review' && !overrideReason) {
    throw conflict('Verification returned warnings. A pharmacist must supply an override reason to continue.', {
      warnings: indent.verification.checks.filter((c) => c.severity === 'warn').map((c) => c.message),
    });
  }
  if ([STATUS.IN_TRANSIT, STATUS.DELIVERED].includes(indent.status)) {
    throw conflict(`Indent ${indentId} is already ${indent.status}`);
  }

  const prescription = await fhir.getMedicationRequest(indent.prescriptionId);
  const courier = COURIERS.find((c) => c.id === courierId) || pickCourier(indent.id);
  const minutes = transitMinutesFor(indent.ward);
  const preparedIso = new Date().toISOString();
  const etaIso = new Date(Date.now() + minutes * 60 * 1000).toISOString();
  const spec = indent.coldChainSpec;

  const resource = buildMedicationDispense({
    prescription,
    patientRef: indent.patientRef,
    encounterRef: indent.encounterRef,
    medicationCodeableConcept: prescription.medicationCodeableConcept,
    quantity: { value: indent.requestedDrug.dispenseQuantity || 1, unit: indent.requestedDrug.dispenseUnits || 'vial' },
    daysSupply: { value: 1, unit: 'day', system: 'http://unitsofmeasure.org', code: 'd' },
    performerRef: `Practitioner/${actor.practitionerId || 'PHARM2201'}`,
    destinationRef: `Location/${indent.ward}-${indent.room}${indent.bed}`,
    receiverRefs: [indent.patientRef],
    courier,
    etaIso,
    preparedIso,
    indentId: indent.id,
    tempRange: { min: spec.minCelsius ?? config.coldChain.minCelsius, max: spec.maxCelsius ?? config.coldChain.maxCelsius },
    status: 'in-progress',
    note: overrideReason ? `Pharmacist override: ${overrideReason}` : undefined,
  });

  const saved = await fhir.createMedicationDispense(resource);
  await fhir.createProvenance(buildProvenance({
    targetRefs: [`MedicationDispense/${saved.id}`],
    actorRef: `Practitioner/${actor.practitionerId || 'PHARM2201'}`,
    activityCode: 'CREATE',
    activityDisplay: 'create',
  }));

  const telemetry = coldChain.startTrip({
    indentId: indent.id,
    minCelsius: spec.minCelsius ?? config.coldChain.minCelsius,
    maxCelsius: spec.maxCelsius ?? config.coldChain.maxCelsius,
    forceExcursion,
  });

  indent.delivery = {
    medicationDispenseId: saved.id,
    courier,
    preparedAt: preparedIso,
    eta: etaIso,
    etaMinutes: minutes,
    overrideReason: overrideReason || null,
    packedBy: { id: actor.id, name: actor.name, role: actor.role },
    deliveredAt: null,
    receivedBy: null,
  };
  indent.status = STATUS.IN_TRANSIT;
  touch(indent);

  await audit.record({
    action: 'C',
    subtypeCode: 'create',
    subtypeDisplay: 'MedicationDispense created',
    actor,
    sourceIp,
    patientRef: indent.patientRef,
    entities: [
      { reference: `MedicationDispense/${saved.id}`, name: 'Dispense record' },
      { reference: `MedicationRequest/${prescription.id}`, name: 'Authorising prescription' },
    ],
    summary: `Indent ${indent.id} packed and handed to courier ${courier.id}`,
  });

  await publishAlert(indent, {
    status: 'in-transit',
    severity: 'info',
    courier,
    etaIso,
    telemetry,
    actor,
  });

  return indent;
}

/** Nurse confirms receipt at the bedside. */
async function markDelivered(indentId, { receivedBy }, actor, sourceIp) {
  const indent = requireIndent(indentId);
  if (indent.status !== STATUS.IN_TRANSIT) {
    throw conflict(`Only an in-transit indent can be received. This one is ${indent.status}.`);
  }

  const telemetry = coldChain.close(indent.id);
  const dispenseResource = await fhir.read('MedicationDispense', indent.delivery.medicationDispenseId);
  if (dispenseResource) {
    dispenseResource.status = telemetry && telemetry.breached ? 'on-hold' : 'completed';
    dispenseResource.whenHandedOver = new Date().toISOString();
    await fhir.updateMedicationDispense(dispenseResource);
  }

  indent.delivery.deliveredAt = new Date().toISOString();
  indent.delivery.receivedBy = receivedBy || { id: actor.id, name: actor.name, role: actor.role };
  indent.delivery.coldChainOutcome = telemetry;
  indent.status = STATUS.DELIVERED;
  touch(indent);

  await audit.record({
    action: 'U',
    subtypeCode: 'update',
    subtypeDisplay: 'MedicationDispense handed over',
    outcome: telemetry && telemetry.breached ? OUTCOME.minorFailure : OUTCOME.success,
    outcomeDesc: telemetry && telemetry.breached ? 'Delivered after a cold-chain excursion; quarantine required' : undefined,
    actor,
    sourceIp,
    patientRef: indent.patientRef,
    entities: [{ reference: `MedicationDispense/${indent.delivery.medicationDispenseId}`, name: 'Dispense record' }],
    summary: `Indent ${indent.id} received on the ward`,
  });

  await publishAlert(indent, {
    status: telemetry && telemetry.breached ? 'delivered-quarantine' : 'delivered',
    severity: telemetry && telemetry.breached ? 'critical' : 'success',
    courier: indent.delivery.courier,
    etaIso: indent.delivery.eta,
    telemetry,
    actor,
  });

  return indent;
}

async function cancel(indentId, { reason }, actor, sourceIp) {
  const indent = requireIndent(indentId);
  if (indent.status === STATUS.DELIVERED) throw conflict('A delivered indent cannot be cancelled');

  coldChain.close(indent.id);
  indent.status = STATUS.CANCELLED;
  indent.blockedReason = reason || 'Cancelled by ward';
  touch(indent);

  await audit.record({
    action: 'U',
    subtypeCode: 'update',
    subtypeDisplay: 'Indent cancelled',
    actor,
    sourceIp,
    patientRef: indent.patientRef,
    entities: [],
    summary: `Indent ${indent.id} cancelled: ${indent.blockedReason}`,
  });

  return indent;
}

/**
 * Builds, guards, and publishes the ward alert.
 *
 * `assertNoPhi` runs against the real identifiers this service holds for the
 * patient. If a future change leaks one of them into the alert, publishing
 * fails instead of succeeding quietly.
 */
async function publishAlert(indent, { status, severity, courier, etaIso, telemetry, actor }) {
  const patient = await fhir.read('Patient', indent.patientId);

  const alert = phi.buildWardAlert({
    indent,
    courier,
    etaIso,
    drugDisplay: indent.requestedDrug.display,
    doseSummary: indent.doseSummary,
    coldChain: {
      minCelsius: telemetry?.minCelsius ?? indent.coldChainSpec.minCelsius,
      maxCelsius: telemetry?.maxCelsius ?? indent.coldChainSpec.maxCelsius,
      currentCelsius: telemetry?.currentCelsius ?? null,
      breached: Boolean(telemetry?.breached),
    },
    status,
    severity,
    bed: indent.room && indent.bed ? `${indent.room}-${indent.bed}` : indent.room || null,
    ward: indent.ward,
  });

  phi.assertNoPhi(alert, phi.knownIdentifiersOf(patient, indent._phi));

  const published = notifications.publish(alert);
  indent.alerts.push(published.id);
  logger.info('ward.alert.published', { indentId: indent.id, status, severity });
  // Phones hear about it even with the app closed. Not awaited: the ward queue
  // must not wait on a third-party push service.
  push.sendAlert(published, { excludeStaffId: actor && actor.id });
  return published;
}

// --- Ward requests ---------------------------------------------------------
//
// A nurse asks the pharmacy for a refrigerated product from the app. The request
// travels the way a ward order system would send it: as an HL7 v2 OMP^O09,
// built from the chart, parsed by the same library as any other inbound order,
// and turned into an indent by the same code. Nothing about a request from the
// app is trusted more than a message from the interface engine.

const ROUTE_CODES = { 34206005: 'SC', 47625008: 'IV', 78421000: 'IM', 26643006: 'PO' };
const DOSE_FORM_CODES = { 'Injectable Solution': 'SOLN', 'Prefilled Syringe': 'SYR', 'Pen Injector': 'PEN', 'Oral Tablet': 'TAB' };
const UNIT_NAMES = { '[iU]': 'International Unit', ug: 'microgram', mg: 'milligram', mL: 'milliliter' };

/** Ward, room and bed from an inpatient encounter's current location. */
function bedOf(encounter) {
  const display = encounter?.location?.[0]?.location?.display || '';
  const match = /^(\S+)\s*\/\s*Bed\s+(\w+)-(\w+)$/.exec(display);
  return match ? { ward: match[1], room: match[2], bed: match[3] } : null;
}

function rxnormCodingOf(request) {
  return (request?.medicationCodeableConcept?.coding || []).find((coding) => /rxnorm/i.test(coding.system || '')) || null;
}

function hl7Timestamp(date) {
  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}`
    + `${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}+0000`;
}

/** "Q24H" from a FHIR timing of once every day, and so on. */
function intervalOf(timing) {
  const repeat = timing?.repeat;
  if (!repeat || !repeat.frequency || !repeat.period) return '';
  const hoursPerUnit = { h: 1, d: 24, wk: 168 }[repeat.periodUnit];
  if (!hoursPerUnit) return '';
  const hours = (repeat.period * hoursPerUnit) / repeat.frequency;
  return Number.isInteger(hours) ? `Q${hours}H` : '';
}

function nextIndentId(now) {
  const prefix = `IND-${now.getUTCFullYear()}-`;
  let highest = 0;
  for (const id of indents.keys()) {
    if (id.startsWith(prefix)) highest = Math.max(highest, Number.parseInt(id.slice(prefix.length), 10) || 0);
  }
  return `${prefix}${String(highest + 1).padStart(4, '0')}`;
}

/**
 * The refrigerated products a ward can ask for right now: every active
 * prescription for a patient currently in a bed on that ward.
 */
async function orderableFor({ ward }) {
  const encounters = await fhir.search('Encounter', { status: 'in-progress' });
  const results = [];

  for (const encounter of encounters) {
    const place = bedOf(encounter);
    if (!place || (ward && place.ward !== ward)) continue;
    const patientId = referenceIdOf(encounter.subject);
    const requests = await fhir.activeMedicationRequestsFor(patientId);

    for (const request of requests) {
      const coding = rxnormCodingOf(request);
      if (!coding || !rxnorm.coldChainFor(coding.code).required) continue;
      const open = [...indents.values()].find((indent) => (
        indent.prescriptionId === request.id && ![STATUS.DELIVERED, STATUS.CANCELLED].includes(indent.status)
      ));
      results.push({
        prescriptionId: request.id,
        ward: place.ward,
        room: place.room,
        bed: place.bed,
        bedLabel: `${place.ward} / ${place.room}-${place.bed}`,
        subjectToken: phi.pseudonym(patientId),
        drug: { rxcui: coding.code, display: coding.display || request.medicationCodeableConcept.text },
        instructions: doseSummaryOf(request),
        openIndent: open ? { id: open.id, status: open.status } : null,
      });
    }
  }

  return results.sort((a, b) => a.bedLabel.localeCompare(b.bedLabel));
}

async function requestFromWard({ prescriptionId, doses = 1, priority = 'routine', note }, actor, sourceIp) {
  const request = await fhir.readOrThrow('MedicationRequest', prescriptionId);
  if (request.status !== 'active') {
    throw conflict(`This prescription is ${request.status}. Ask the prescriber to review it before requesting the product.`);
  }
  const coding = rxnormCodingOf(request);
  if (!coding) throw conflict('This prescription carries no RxNorm code, so the pharmacy cannot check it.');

  const encounter = await fhir.read('Encounter', referenceIdOf(request.encounter));
  const place = bedOf(encounter);
  if (!place) throw conflict('The patient on this prescription is not in a bed on an inpatient ward.');
  if (actor.ward && place.ward !== actor.ward) {
    throw forbidden(`You can request medication for ${actor.ward} only.`);
  }

  const patientId = referenceIdOf(request.subject);
  const patient = await fhir.readOrThrow('Patient', patientId);
  const prescriber = await fhir.read('Practitioner', referenceIdOf(request.requester));
  const concept = await rxnorm.getConcept(coding.code);
  const dosage = request.dosageInstruction?.[0];
  const dose = dosage?.doseAndRate?.[0]?.doseQuantity || {};
  const route = dosage?.route?.coding?.[0];
  const name = patient.name?.[0] || {};
  const address = patient.address?.[0] || {};
  const esc = escapeText;

  const now = new Date();
  const stamp = hl7Timestamp(now);
  const indentId = nextIndentId(now);
  const [actorGiven, ...actorRest] = String(actor.name || '').split(' ');

  const message = ompO09({
    stamp,
    controlId: `WARD${now.getTime()}`,
    indentId,
    fillerId: indentId.replace(/^IND/, 'PH'),
    mrn: esc(patient.identifier?.[0]?.value),
    family: esc(name.family),
    given: esc(name.given?.[0]),
    middle: esc(name.given?.[1]),
    birthDate: String(patient.birthDate || '').replace(/-/g, ''),
    sex: { female: 'F', male: 'M' }[patient.gender] || 'U',
    phone: esc((patient.telecom || []).find((entry) => entry.system === 'phone')?.value),
    address: [esc((address.line || []).join(' ')), '', esc(address.city), '', esc(address.postalCode), esc(address.country)].join('^'),
    ward: place.ward,
    room: place.room,
    bed: place.bed,
    visitNumber: esc(encounter.id),
    rxcui: coding.code,
    drugName: esc(coding.display),
    doseValue: dose.value ?? '',
    doseUnit: esc(dose.code || dose.unit),
    doseUnitText: esc(UNIT_NAMES[dose.code] || dose.unit),
    doseForm: DOSE_FORM_CODES[concept?.doseForm] || 'OTH',
    doseFormText: esc(concept?.doseForm || ''),
    routeCode: ROUTE_CODES[route?.code] || 'OTH',
    routeText: esc(route?.display || ''),
    dispenseQty: doses,
    orderingProvider: prescriber
      ? `${esc(prescriber.id)}^${esc(prescriber.name?.[0]?.family)}^${esc(prescriber.name?.[0]?.given?.[0])}`
      : '',
    enteredBy: `${esc(actor.id)}^${esc(actorRest.join(' '))}^${esc(actorGiven)}`,
    interval: intervalOf(dosage?.timing),
    startAt: stamp,
    priority: priority === 'urgent' ? 'S' : 'R',
    notes: [
      'COLD CHAIN 2-8 C. DO NOT FREEZE.',
      note ? esc(`Ward note: ${note}`) : null,
    ].filter(Boolean),
    includeObx: false,
  });

  const parsed = hl7.parse(message);
  const indent = await upsertFromHl7(parsed, actor, sourceIp);
  indent.prescriptionId = request.id;
  indent.requestChannel = 'ward-app';

  await publishAlert(indent, {
    status: 'requested',
    severity: 'info',
    courier: { id: '-', name: 'Not yet assigned', role: 'Pharmacy queue' },
    etaIso: null,
    telemetry: { minCelsius: indent.coldChainSpec.minCelsius, maxCelsius: indent.coldChainSpec.maxCelsius },
    actor,
  });

  return {
    indent,
    // What the ward device may see of the message: its shape and the ACK, never
    // the PID segment it carried.
    hl7: {
      messageType: parsed.header.messageType,
      version: parsed.header.versionId,
      messageControlId: parsed.header.messageControlId,
      segments: parsed.segments,
      ack: hl7.buildAck(parsed.header, { accepted: true }),
      acknowledgementCode: 'AA',
    },
  };
}

function list({ ward, status } = {}) {
  let results = [...indents.values()];
  if (ward) results = results.filter((indent) => indent.ward === ward);
  if (status) {
    const wanted = String(status).split(',');
    results = results.filter((indent) => wanted.includes(indent.status));
  }
  return results
    .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)))
    .map(publicView);
}

function get(indentId) {
  return publicView(requireIndent(indentId));
}

function raw(indentId) {
  return requireIndent(indentId);
}

function reset() {
  indents.clear();
  coldChain.reset();
}

/** Restores the baseline ward queue the service ships with. */
/**
 * Rebuilding the starting queue replays verifications and a dispense. Those are
 * not news to anyone, so no phone is woken up for them.
 */
function restoreBaseline(actor) {
  return push.withoutPush(() => rebuildBaseline(actor));
}

async function rebuildBaseline(actor = { id: 'SYSTEM', name: 'Interface engine', role: 'system' }) {
  reset();
  const messages = [
    samples.valid(),
    samples.wrongStrength(),
    samples.wrongDrug(),
    samples.temperatureExcursion(),
  ];

  const created = [];
  for (const message of messages) {
    const parsed = hl7.parse(message);
    try {
      const indent = await upsertFromHl7(parsed, actor, '127.0.0.1');
      created.push(indent.id);
    } catch (err) {
      logger.warn('seed.indent.skipped', { reason: err.message });
    }
  }

  // The queue starts with a realistic spread of states across the lifecycle.
  if (indents.has('IND-2026-0091')) {
    await verify('IND-2026-0091', actor, '127.0.0.1');
  }
  if (indents.has('IND-2026-0093')) {
    await verify('IND-2026-0093', actor, '127.0.0.1');
  }
  if (indents.has('IND-2026-0094')) {
    const indent = indents.get('IND-2026-0094');
    await verify('IND-2026-0094', actor, '127.0.0.1');
    if (indent.verification.verdict !== 'fail') {
      await dispense('IND-2026-0094', { courierId: 'CUR-02', overrideReason: 'Cold-chain probe alarm under review by pharmacist', forceExcursion: true }, actor, '127.0.0.1');
      // Backfill a short history so the ward sees a real trace, and an
      // excursion, the moment the app opens rather than minutes later.
      const step = config.coldChain.sampleSeconds * 1000;
      const start = Date.now() - 13 * step;
      for (let i = 1; i <= 13; i += 1) {
        coldChain.sample('IND-2026-0094', undefined, new Date(start + i * step).toISOString());
      }
    }
  }

  return created;
}

function couriers() {
  return COURIERS.map((courier) => ({ ...courier, transitMinutes: undefined }));
}

module.exports = {
  STATUS,
  COURIERS,
  couriers,
  list,
  get,
  raw,
  verify,
  dispense,
  markDelivered,
  cancel,
  upsertFromHl7,
  orderableFor,
  requestFromWard,
  publicView,
  reset,
  restoreBaseline,
  transitMinutesFor,
  newIndentId: () => `IND-${new Date().getFullYear()}-${randomUUID().slice(0, 4).toUpperCase()}`,
};
