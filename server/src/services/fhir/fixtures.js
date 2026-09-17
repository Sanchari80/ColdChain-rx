'use strict';

/**
 * Synthetic FHIR R4 seed data for DATA_MODE=mock.
 *
 * Every patient here is invented. No real person, MRN, or contact detail
 * appears in this file, and none of it should ever be replaced with real
 * patient data — point DATA_MODE=live at a sandbox server instead.
 */

const SNOMED = 'http://snomed.info/sct';
const RXNORM = 'http://www.nlm.nih.gov/research/umls/rxnorm';
const UCUM = 'http://unitsofmeasure.org';

const patients = [
  {
    resourceType: 'Patient',
    id: 'P-1001',
    meta: { profile: ['http://hl7.org/fhir/us/core/StructureDefinition/us-core-patient'] },
    identifier: [
      { use: 'usual', type: { coding: [{ system: 'http://terminology.hl7.org/CodeSystem/v2-0203', code: 'MR' }] }, system: 'urn:oid:2.16.840.1.113883.19.5', value: 'MRN0012345' },
    ],
    active: true,
    name: [{ use: 'official', family: 'Rahman', given: ['Ayesha', 'Binte'] }],
    telecom: [{ system: 'phone', value: '+8801711000001', use: 'mobile' }],
    gender: 'female',
    birthDate: '1978-04-12',
    address: [{ line: ['12 Gulshan Avenue'], city: 'Dhaka', postalCode: '1212', country: 'BD' }],
  },
  {
    resourceType: 'Patient',
    id: 'P-1002',
    identifier: [{ use: 'usual', system: 'urn:oid:2.16.840.1.113883.19.5', value: 'MRN0012346' }],
    active: true,
    name: [{ use: 'official', family: 'Hossain', given: ['Tanvir'] }],
    telecom: [{ system: 'phone', value: '+8801711000002', use: 'mobile' }],
    gender: 'male',
    birthDate: '1965-11-03',
    address: [{ line: ['5/B Dhanmondi'], city: 'Dhaka', postalCode: '1209', country: 'BD' }],
  },
  {
    resourceType: 'Patient',
    id: 'P-1003',
    identifier: [{ use: 'usual', system: 'urn:oid:2.16.840.1.113883.19.5', value: 'MRN0012347' }],
    active: true,
    name: [{ use: 'official', family: 'Barua', given: ['Mitu'] }],
    telecom: [{ system: 'phone', value: '+8801711000003', use: 'mobile' }],
    gender: 'female',
    birthDate: '1992-02-20',
    address: [{ line: ['22 Uttara Sector 7'], city: 'Dhaka', postalCode: '1230', country: 'BD' }],
  },
  {
    resourceType: 'Patient',
    id: 'P-1004',
    identifier: [{ use: 'usual', system: 'urn:oid:2.16.840.1.113883.19.5', value: 'MRN0012348' }],
    active: true,
    name: [{ use: 'official', family: 'Alam', given: ['Shafiqul'] }],
    telecom: [{ system: 'phone', value: '+8801711000004', use: 'mobile' }],
    gender: 'male',
    birthDate: '1954-07-30',
    address: [{ line: ['8 Mirpur DOHS'], city: 'Dhaka', postalCode: '1216', country: 'BD' }],
  },
];

const practitioners = [
  {
    resourceType: 'Practitioner',
    id: 'PHY4410',
    identifier: [{ system: 'urn:oid:2.16.840.1.113883.4.6', value: 'NPI4410' }],
    active: true,
    name: [{ family: 'Chowdhury', given: ['Imran'], prefix: ['Dr'] }],
  },
  {
    resourceType: 'Practitioner',
    id: 'PHY4411',
    active: true,
    name: [{ family: 'Karim', given: ['Nusrat'], prefix: ['Dr'] }],
  },
  {
    resourceType: 'Practitioner',
    id: 'NUR9931',
    active: true,
    name: [{ family: 'Hasan', given: ['Mim'] }],
  },
  {
    resourceType: 'Practitioner',
    id: 'PHARM2201',
    active: true,
    name: [{ family: 'Saha', given: ['Rupom'] }],
  },
];

const encounters = [
  {
    resourceType: 'Encounter',
    id: 'ENC-7001',
    status: 'in-progress',
    class: { system: 'http://terminology.hl7.org/CodeSystem/v3-ActCode', code: 'IMP', display: 'inpatient encounter' },
    subject: { reference: 'Patient/P-1001' },
    location: [{ location: { reference: 'Location/IPD-7B-712A', display: 'IPD-7B / Bed 712-A' } }],
  },
  {
    resourceType: 'Encounter',
    id: 'ENC-7002',
    status: 'in-progress',
    class: { system: 'http://terminology.hl7.org/CodeSystem/v3-ActCode', code: 'IMP', display: 'inpatient encounter' },
    subject: { reference: 'Patient/P-1002' },
    location: [{ location: { reference: 'Location/IPD-7B-714C', display: 'IPD-7B / Bed 714-C' } }],
  },
  {
    resourceType: 'Encounter',
    id: 'ENC-7003',
    status: 'in-progress',
    class: { system: 'http://terminology.hl7.org/CodeSystem/v3-ActCode', code: 'IMP', display: 'inpatient encounter' },
    subject: { reference: 'Patient/P-1003' },
    location: [{ location: { reference: 'Location/IPD-9A-903B', display: 'IPD-9A / Bed 903-B' } }],
  },
  {
    resourceType: 'Encounter',
    id: 'ENC-7004',
    status: 'in-progress',
    class: { system: 'http://terminology.hl7.org/CodeSystem/v3-ActCode', code: 'IMP', display: 'inpatient encounter' },
    subject: { reference: 'Patient/P-1004' },
    location: [{ location: { reference: 'Location/IPD-9A-907A', display: 'IPD-9A / Bed 907-A' } }],
  },
];

function medicationRequest({ id, patient, encounter, requester, status, rxcui, display, doseValue, doseUnit, doseCode, route, frequency, period, note }) {
  return {
    resourceType: 'MedicationRequest',
    id,
    meta: { profile: ['http://hl7.org/fhir/us/core/StructureDefinition/us-core-medicationrequest'] },
    status,
    intent: 'order',
    category: [{
      coding: [{ system: 'http://terminology.hl7.org/CodeSystem/medicationrequest-category', code: 'inpatient', display: 'Inpatient' }],
    }],
    medicationCodeableConcept: {
      coding: [{ system: RXNORM, code: rxcui, display }],
      text: display,
    },
    subject: { reference: `Patient/${patient}` },
    encounter: { reference: `Encounter/${encounter}` },
    authoredOn: '2026-09-16T04:10:00Z',
    requester: { reference: `Practitioner/${requester}` },
    dosageInstruction: [{
      text: `${doseValue} ${doseUnit} ${route.display} ${frequency.text}`,
      timing: {
        repeat: { frequency: frequency.frequency, period: frequency.period, periodUnit: frequency.periodUnit },
      },
      route: { coding: [{ system: SNOMED, code: route.code, display: route.display }] },
      doseAndRate: [{
        doseQuantity: { value: doseValue, unit: doseUnit, system: UCUM, code: doseCode },
      }],
    }],
    dispenseRequest: {
      validityPeriod: period,
      quantity: { value: 1, unit: 'vial', system: 'http://terminology.hl7.org/CodeSystem/v3-orderableDrugForm', code: 'VIAL' },
      numberOfRepeatsAllowed: 0,
    },
    note: note ? [{ text: note }] : undefined,
  };
}

const medicationRequests = [
  medicationRequest({
    id: 'MR-9001',
    patient: 'P-1001',
    encounter: 'ENC-7001',
    requester: 'PHY4410',
    status: 'active',
    rxcui: '311041',
    display: 'Insulin Glargine 100 UNT/ML Injectable Solution',
    doseValue: 18,
    doseUnit: 'IU',
    doseCode: '[iU]',
    route: { code: '34206005', display: 'Subcutaneous route' },
    frequency: { text: 'once daily at bedtime', frequency: 1, period: 1, periodUnit: 'd' },
    period: { start: '2026-09-14', end: '2026-09-30' },
    note: 'Store 2-8 C. Do not freeze. Discard if frozen.',
  }),
  medicationRequest({
    id: 'MR-9002',
    patient: 'P-1002',
    encounter: 'ENC-7002',
    requester: 'PHY4411',
    status: 'active',
    rxcui: '727578',
    display: 'Filgrastim 300 MCG/0.5ML Injection',
    doseValue: 300,
    doseUnit: 'ug',
    doseCode: 'ug',
    route: { code: '34206005', display: 'Subcutaneous route' },
    frequency: { text: 'once daily', frequency: 1, period: 1, periodUnit: 'd' },
    period: { start: '2026-09-15', end: '2026-09-22' },
    note: 'Store 2-8 C. Protect from light. Do not shake.',
  }),
  medicationRequest({
    id: 'MR-9003',
    patient: 'P-1003',
    encounter: 'ENC-7003',
    requester: 'PHY4410',
    status: 'active',
    rxcui: '1546063',
    display: 'Adalimumab 40 MG/0.8ML Prefilled Syringe',
    doseValue: 40,
    doseUnit: 'mg',
    doseCode: 'mg',
    route: { code: '34206005', display: 'Subcutaneous route' },
    frequency: { text: 'every 14 days', frequency: 1, period: 14, periodUnit: 'd' },
    period: { start: '2026-09-10', end: '2026-11-10' },
    note: 'Store 2-8 C in original carton. Do not freeze.',
  }),
  medicationRequest({
    id: 'MR-9004',
    patient: 'P-1004',
    encounter: 'ENC-7004',
    requester: 'PHY4411',
    // Deliberately stopped: the ward can still raise an indent against it and
    // the safety gate must block the dispense. This drives the red path demo.
    status: 'stopped',
    rxcui: '1670007',
    display: 'Insulin Aspart 100 UNT/ML Injectable Solution',
    doseValue: 6,
    doseUnit: 'IU',
    doseCode: '[iU]',
    route: { code: '34206005', display: 'Subcutaneous route' },
    frequency: { text: 'three times daily with meals', frequency: 3, period: 1, periodUnit: 'd' },
    period: { start: '2026-09-11', end: '2026-09-16' },
    note: 'Store 2-8 C until first use.',
  }),
];

const locations = [
  { resourceType: 'Location', id: 'IPD-7B-712A', status: 'active', name: 'IPD-7B / Bed 712-A', mode: 'instance' },
  { resourceType: 'Location', id: 'IPD-7B-714C', status: 'active', name: 'IPD-7B / Bed 714-C', mode: 'instance' },
  { resourceType: 'Location', id: 'IPD-9A-903B', status: 'active', name: 'IPD-9A / Bed 903-B', mode: 'instance' },
  { resourceType: 'Location', id: 'IPD-9A-907A', status: 'active', name: 'IPD-9A / Bed 907-A', mode: 'instance' },
  { resourceType: 'Location', id: 'MAINPHARM', status: 'active', name: 'Main Pharmacy, Level 2', mode: 'instance' },
];

const organizations = [
  { resourceType: 'Organization', id: 'HOSP', active: true, name: 'Shaheed Memorial General Hospital' },
];

module.exports = { patients, practitioners, encounters, medicationRequests, locations, organizations };
