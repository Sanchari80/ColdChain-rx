'use strict';

const config = require('../../config');
const { requestJson } = require('../../util/http');
const { notFound, upstream } = require('../../util/errors');
const logger = require('../../util/logger');
const store = require('./mockFhirStore');

const JSON_FHIR = 'application/fhir+json';

function authHeaders() {
  const headers = { Accept: JSON_FHIR };
  if (config.fhir.token) headers.Authorization = `Bearer ${config.fhir.token}`;
  return headers;
}

function queryString(params) {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params || {})) {
    if (value === undefined || value === null || value === '') continue;
    search.append(key, String(value));
  }
  const qs = search.toString();
  return qs ? `?${qs}` : '';
}

async function liveRead(type, id) {
  try {
    return await requestJson(`${config.fhir.baseUrl}/${type}/${encodeURIComponent(id)}`, {
      headers: authHeaders(),
      timeoutMs: config.fhir.timeoutMs,
      label: 'FHIR server',
    });
  } catch (err) {
    if (err.details && err.details.status === 404) return null;
    throw err;
  }
}

async function liveSearch(type, params) {
  return requestJson(`${config.fhir.baseUrl}/${type}${queryString(params)}`, {
    headers: authHeaders(),
    timeoutMs: config.fhir.timeoutMs,
    label: 'FHIR server',
  });
}

async function liveUpdate(type, resource) {
  return requestJson(`${config.fhir.baseUrl}/${type}/${encodeURIComponent(resource.id)}`, {
    method: 'PUT',
    headers: { ...authHeaders(), 'Content-Type': JSON_FHIR },
    body: JSON.stringify(resource),
    timeoutMs: config.fhir.timeoutMs,
    label: 'FHIR server',
  });
}

async function liveCreate(type, resource) {
  return requestJson(`${config.fhir.baseUrl}/${type}`, {
    method: 'POST',
    headers: { ...authHeaders(), 'Content-Type': JSON_FHIR },
    body: JSON.stringify(resource),
    timeoutMs: config.fhir.timeoutMs,
    label: 'FHIR server',
  });
}

const isLive = () => config.dataMode === 'live';

/** Flattens a searchset Bundle into a plain array of resources. */
function bundleEntries(bundle) {
  if (!bundle) return [];
  if (bundle.resourceType !== 'Bundle') {
    throw upstream('FHIR server returned a non-Bundle response to a search', { got: bundle.resourceType });
  }
  return (bundle.entry || []).map((entry) => entry.resource).filter(Boolean);
}

const fhir = {
  mode: () => config.dataMode,
  baseUrl: () => (isLive() ? config.fhir.baseUrl : 'memory://mock-fhir'),

  async read(type, id) {
    return isLive() ? liveRead(type, id) : store.read(type, id);
  },

  async readOrThrow(type, id) {
    const resource = await fhir.read(type, id);
    if (!resource) throw notFound(`${type}/${id} does not exist on the FHIR server`);
    return resource;
  },

  async search(type, params) {
    const bundle = isLive() ? await liveSearch(type, params) : store.search(type, params);
    return bundleEntries(bundle);
  },

  async create(type, resource) {
    const created = isLive() ? await liveCreate(type, resource) : store.create(type, resource);
    logger.debug('fhir.create', { type, id: created && created.id });
    return created;
  },

  async update(type, resource) {
    const saved = isLive() ? await liveUpdate(type, resource) : store.update(type, resource);
    logger.debug('fhir.update', { type, id: saved && saved.id });
    return saved;
  },

  // --- Domain helpers -------------------------------------------------------

  getMedicationRequest: (id) => fhir.readOrThrow('MedicationRequest', id),
  getPatient: (id) => fhir.readOrThrow('Patient', id),
  getEncounter: (id) => fhir.read('Encounter', id),
  getPractitioner: (id) => fhir.read('Practitioner', id),

  activeMedicationRequestsFor: (patientId) =>
    fhir.search('MedicationRequest', { patient: patientId, status: 'active' }),

  createMedicationDispense: (resource) => fhir.create('MedicationDispense', resource),
  updateMedicationDispense: (resource) => fhir.update('MedicationDispense', resource),
  createAuditEvent: (resource) => fhir.create('AuditEvent', resource),
  createProvenance: (resource) => fhir.create('Provenance', resource),

  dispensesForPrescription: (medicationRequestId) =>
    fhir.search('MedicationDispense', { prescription: `MedicationRequest/${medicationRequestId}` }),

  recentAuditEvents: (limit = 50) =>
    fhir.search('AuditEvent', { _count: limit, _sort: '-_lastUpdated' }),

  // Exposed so tests can restore a clean world between cases.
  _resetMock: () => store.reset(),
};

module.exports = fhir;
