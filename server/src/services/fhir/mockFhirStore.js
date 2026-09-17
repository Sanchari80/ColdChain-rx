'use strict';

const { randomUUID } = require('node:crypto');
const fixtures = require('./fixtures');

/**
 * A deliberately small in-memory FHIR R4 server.
 *
 * It implements only what this service calls: read by id, a handful of search
 * parameters, and create. Responses are shaped exactly like a real server's
 * (searchset Bundles, resources carrying meta.versionId and lastUpdated) so the
 * same client code runs unchanged against HAPI FHIR in live mode.
 */

class MockFhirStore {
  constructor() {
    this.reset();
  }

  reset() {
    /** @type {Map<string, Map<string, object>>} resourceType -> id -> resource */
    this.collections = new Map();
    const seed = [
      ...fixtures.patients,
      ...fixtures.practitioners,
      ...fixtures.encounters,
      ...fixtures.medicationRequests,
      ...fixtures.locations,
      ...fixtures.organizations,
    ];
    for (const resource of seed) {
      this.#put(resource.resourceType, structuredClone(resource));
    }
  }

  #collection(type) {
    if (!this.collections.has(type)) this.collections.set(type, new Map());
    return this.collections.get(type);
  }

  #put(type, resource) {
    const current = this.#collection(type).get(resource.id);
    const version = current ? String(Number(current.meta.versionId) + 1) : '1';
    resource.meta = {
      ...(resource.meta || {}),
      versionId: version,
      lastUpdated: new Date().toISOString(),
    };
    this.#collection(type).set(resource.id, resource);
    return resource;
  }

  read(type, id) {
    const resource = this.#collection(type).get(id);
    return resource ? structuredClone(resource) : null;
  }

  update(type, resource) {
    if (!resource.id) throw new Error('update requires resource.id');
    const copy = structuredClone(resource);
    copy.resourceType = type;
    return structuredClone(this.#put(type, copy));
  }

  create(type, resource) {
    const copy = structuredClone(resource);
    copy.id = copy.id || `${type.toLowerCase()}-${randomUUID()}`;
    copy.resourceType = type;
    return structuredClone(this.#put(type, copy));
  }

  /**
   * Supported search params, matched the way a FHIR server would:
   *   patient / subject      -> reference, accepts "P-1001" or "Patient/P-1001"
   *   status                 -> token, comma separated OR
   *   encounter              -> reference
   *   _id                    -> token
   *   _count, _sort=-_lastUpdated
   *   entity (AuditEvent)    -> reference to any entity.what
   */
  search(type, params = {}) {
    const all = [...this.#collection(type).values()].map((r) => structuredClone(r));
    const count = Number.parseInt(params._count, 10) || 200;

    const matches = all.filter((resource) => {
      for (const [key, rawValue] of Object.entries(params)) {
        if (rawValue === undefined || rawValue === null || rawValue === '') continue;
        if (key.startsWith('_')) continue;
        const values = String(rawValue).split(',');
        if (!matchParam(resource, key, values)) return false;
      }
      return true;
    });

    if (params._sort === '-_lastUpdated') {
      matches.sort((a, b) => String(b.meta?.lastUpdated || '').localeCompare(String(a.meta?.lastUpdated || '')));
    }

    const page = matches.slice(0, count);
    return {
      resourceType: 'Bundle',
      id: randomUUID(),
      type: 'searchset',
      total: matches.length,
      entry: page.map((resource) => ({
        fullUrl: `urn:uuid:${resource.id}`,
        resource,
        search: { mode: 'match' },
      })),
    };
  }
}

function referenceId(reference) {
  if (!reference) return null;
  const value = typeof reference === 'string' ? reference : reference.reference;
  if (!value) return null;
  const parts = value.split('/');
  return parts[parts.length - 1];
}

function matchParam(resource, key, values) {
  switch (key) {
    case 'patient':
    case 'subject': {
      const id = referenceId(resource.subject) || referenceId(resource.patient);
      return values.some((v) => referenceId(v) === id);
    }
    case 'encounter': {
      const id = referenceId(resource.encounter) || referenceId(resource.context);
      return values.some((v) => referenceId(v) === id);
    }
    case 'status':
      return values.includes(resource.status);
    case 'prescription': {
      const ids = (resource.authorizingPrescription || []).map(referenceId);
      return values.some((v) => ids.includes(referenceId(v)));
    }
    case 'entity': {
      const ids = (resource.entity || []).map((e) => referenceId(e.what));
      return values.some((v) => ids.includes(referenceId(v)));
    }
    case 'identifier': {
      const ids = (resource.identifier || []).map((i) => i.value);
      return values.some((v) => ids.includes(v));
    }
    default:
      return true;
  }
}

module.exports = new MockFhirStore();
module.exports.MockFhirStore = MockFhirStore;
