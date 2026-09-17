'use strict';

/**
 * Builders for the resources this service writes back to the EHR.
 *
 * Extension URLs live under a project namespace. Cold-chain custody is not in
 * base R4, so it is modelled as first-class extensions rather than stuffed into
 * a free-text note where no downstream system could read it.
 */

const EXT = {
  courier: 'https://coldchain.example.org/fhir/StructureDefinition/courier',
  eta: 'https://coldchain.example.org/fhir/StructureDefinition/estimated-arrival',
  tempRange: 'https://coldchain.example.org/fhir/StructureDefinition/storage-temperature-range',
  excursion: 'https://coldchain.example.org/fhir/StructureDefinition/cold-chain-excursion',
  indent: 'https://coldchain.example.org/fhir/StructureDefinition/ward-indent',
};

const AUDIT_TYPE = 'http://terminology.hl7.org/CodeSystem/audit-event-type';
const RESTFUL_INTERACTION = 'http://hl7.org/fhir/restful-interaction';
const AGENT_TYPE = 'http://terminology.hl7.org/CodeSystem/extra-security-role-type';
const PARTICIPATION = 'http://terminology.hl7.org/CodeSystem/v3-ParticipationType';
const V3_ACT = 'http://terminology.hl7.org/CodeSystem/v3-ActCode';
const OUTCOME = { success: '0', minorFailure: '4', seriousFailure: '8', majorFailure: '12' };

/**
 * MedicationDispense recording that the pharmacy packed the drug and handed it
 * to a named courier, with the cold-chain window it must stay inside.
 */
function buildMedicationDispense({
  prescription,
  patientRef,
  encounterRef,
  medicationCodeableConcept,
  quantity,
  daysSupply,
  performerRef,
  destinationRef,
  receiverRefs = [],
  courier,
  etaIso,
  preparedIso,
  indentId,
  tempRange,
  status = 'in-progress',
  note,
}) {
  return {
    resourceType: 'MedicationDispense',
    meta: { profile: ['http://hl7.org/fhir/StructureDefinition/MedicationDispense'] },
    identifier: [{ system: 'https://coldchain.example.org/indent', value: indentId }],
    status,
    category: {
      coding: [{ system: 'http://terminology.hl7.org/CodeSystem/medicationdispense-category', code: 'inpatient', display: 'Inpatient' }],
    },
    medicationCodeableConcept,
    subject: { reference: patientRef },
    context: encounterRef ? { reference: encounterRef } : undefined,
    performer: [{
      function: { coding: [{ system: 'http://terminology.hl7.org/CodeSystem/medicationdispense-performer-function', code: 'packager', display: 'Packager' }] },
      actor: { reference: performerRef },
    }],
    location: { reference: 'Location/MAINPHARM', display: 'Main Pharmacy, Level 2' },
    authorizingPrescription: [{ reference: `MedicationRequest/${prescription.id}` }],
    type: { coding: [{ system: V3_ACT, code: 'DF', display: 'Daily Fill' }] },
    quantity,
    daysSupply,
    whenPrepared: preparedIso,
    destination: { reference: destinationRef },
    receiver: receiverRefs.map((reference) => ({ reference })),
    dosageInstruction: prescription.dosageInstruction,
    note: note ? [{ text: note }] : undefined,
    extension: [
      {
        url: EXT.courier,
        extension: [
          { url: 'id', valueString: courier.id },
          { url: 'name', valueString: courier.name },
          { url: 'role', valueString: courier.role },
        ],
      },
      { url: EXT.eta, valueInstant: etaIso },
      { url: EXT.indent, valueString: indentId },
      {
        url: EXT.tempRange,
        valueRange: {
          low: { value: tempRange.min, unit: 'C', system: 'http://unitsofmeasure.org', code: 'Cel' },
          high: { value: tempRange.max, unit: 'C', system: 'http://unitsofmeasure.org', code: 'Cel' },
        },
      },
    ],
  };
}

/**
 * AuditEvent for any access to or change of patient data. Under the HIPAA
 * Security Rule (45 CFR 164.312(b)) this record is the evidence that access was
 * tracked; it carries references, never free-text patient demographics.
 */
function buildAuditEvent({
  subtypeCode,
  subtypeDisplay,
  action,
  outcome = OUTCOME.success,
  outcomeDesc,
  actor,
  sourceIp,
  patientRef,
  entities = [],
  purposeOfUse = 'TREAT',
}) {
  return {
    resourceType: 'AuditEvent',
    type: { system: AUDIT_TYPE, code: 'rest', display: 'RESTful Operation' },
    subtype: [{ system: RESTFUL_INTERACTION, code: subtypeCode, display: subtypeDisplay }],
    action,
    recorded: new Date().toISOString(),
    outcome,
    outcomeDesc,
    purposeOfEvent: [{
      coding: [{ system: 'http://terminology.hl7.org/CodeSystem/v3-ActReason', code: purposeOfUse, display: 'Treatment' }],
    }],
    agent: [{
      type: { coding: [{ system: AGENT_TYPE, code: 'humanuser', display: 'human user' }] },
      who: { identifier: { system: 'https://coldchain.example.org/staff', value: actor.id } },
      altId: actor.role,
      requestor: true,
      network: sourceIp ? { address: sourceIp, type: '2' } : undefined,
    }, {
      type: { coding: [{ system: PARTICIPATION, code: 'CST', display: 'custodian' }] },
      who: { identifier: { system: 'https://coldchain.example.org/app', value: 'coldchain-rx-server' } },
      requestor: false,
    }],
    source: {
      site: 'Shaheed Memorial General Hospital / Main Pharmacy',
      observer: { identifier: { system: 'https://coldchain.example.org/app', value: 'coldchain-rx-server' } },
      type: [{ system: 'http://terminology.hl7.org/CodeSystem/security-source-type', code: '4', display: 'Application Server' }],
    },
    entity: [
      patientRef ? {
        what: { reference: patientRef },
        type: { system: 'http://terminology.hl7.org/CodeSystem/audit-entity-type', code: '1', display: 'Person' },
        role: { system: 'http://terminology.hl7.org/CodeSystem/object-role', code: '1', display: 'Patient' },
        securityLabel: [{ system: 'http://terminology.hl7.org/CodeSystem/v3-Confidentiality', code: 'R', display: 'Restricted' }],
      } : null,
      ...entities.map((entity) => ({
        what: { reference: entity.reference },
        type: { system: 'http://terminology.hl7.org/CodeSystem/audit-entity-type', code: '2', display: 'System Object' },
        role: { system: 'http://terminology.hl7.org/CodeSystem/object-role', code: '4', display: 'Domain Resource' },
        name: entity.name,
        description: entity.description,
      })),
    ].filter(Boolean),
  };
}

function buildProvenance({ targetRefs, actorRef, activityCode, activityDisplay }) {
  return {
    resourceType: 'Provenance',
    target: targetRefs.map((reference) => ({ reference })),
    recorded: new Date().toISOString(),
    activity: {
      coding: [{ system: 'http://terminology.hl7.org/CodeSystem/v3-DataOperation', code: activityCode, display: activityDisplay }],
    },
    agent: [{
      type: { coding: [{ system: PARTICIPATION, code: 'AUT', display: 'author' }] },
      who: { reference: actorRef },
    }],
  };
}

module.exports = { buildMedicationDispense, buildAuditEvent, buildProvenance, EXT, OUTCOME };
