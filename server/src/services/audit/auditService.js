'use strict';

const { createHash } = require('node:crypto');
const fhir = require('../fhir/fhirClient');
const { buildAuditEvent, OUTCOME } = require('../fhir/resources');
const logger = require('../../util/logger');

/**
 * Every read of a chart and every write back to it produces a FHIR AuditEvent.
 *
 * On top of the FHIR record this keeps a local hash chain: entry N stores the
 * SHA-256 of (hash of entry N-1 + canonical JSON of entry N). Deleting or
 * editing any entry breaks every hash after it, so tampering is detectable even
 * if someone has write access to the store. That is what "tamper-proof" can
 * actually mean without dedicated append-only hardware.
 */

const GENESIS = '0'.repeat(64);

class AuditService {
  constructor() {
    this.chain = [];
  }

  reset() {
    this.chain = [];
  }

  #previousHash() {
    return this.chain.length ? this.chain[this.chain.length - 1].hash : GENESIS;
  }

  static canonical(value) {
    if (value === null || typeof value !== 'object') return JSON.stringify(value);
    if (Array.isArray(value)) return `[${value.map(AuditService.canonical).join(',')}]`;
    const keys = Object.keys(value).filter((key) => value[key] !== undefined).sort();
    return `{${keys.map((key) => `${JSON.stringify(key)}:${AuditService.canonical(value[key])}`).join(',')}}`;
  }

  /**
   * @param {object} entry
   * @param {string} entry.action C | R | U | D | E
   * @param {string} entry.subtypeCode restful-interaction code, e.g. "create"
   */
  async record(entry) {
    const resource = buildAuditEvent({
      subtypeCode: entry.subtypeCode,
      subtypeDisplay: entry.subtypeDisplay || entry.subtypeCode,
      action: entry.action,
      outcome: entry.outcome || OUTCOME.success,
      outcomeDesc: entry.outcomeDesc,
      actor: entry.actor,
      sourceIp: entry.sourceIp,
      patientRef: entry.patientRef,
      entities: entry.entities || [],
      purposeOfUse: entry.purposeOfUse,
    });

    let saved = resource;
    try {
      saved = await fhir.createAuditEvent(resource);
    } catch (err) {
      // An unreachable FHIR server must not silently drop the audit trail. The
      // local chain still records the attempt, flagged so it can be replayed.
      logger.error('audit.fhir.write.failed', { reason: err.message });
      saved = { ...resource, id: null, _pendingSync: true };
    }

    const body = {
      recorded: saved.recorded,
      action: saved.action,
      outcome: saved.outcome,
      subtype: entry.subtypeCode,
      actorId: entry.actor.id,
      actorRole: entry.actor.role,
      patientRef: entry.patientRef || null,
      entities: (entry.entities || []).map((e) => e.reference),
      summary: entry.summary || null,
      auditEventId: saved.id || null,
      pendingSync: Boolean(saved._pendingSync),
    };

    const previousHash = this.#previousHash();
    const hash = createHash('sha256')
      .update(previousHash)
      .update(AuditService.canonical(body))
      .digest('hex');

    const link = { sequence: this.chain.length + 1, previousHash, hash, ...body };
    this.chain.push(link);
    return link;
  }

  list({ limit = 50, patientRef } = {}) {
    let entries = [...this.chain].reverse();
    if (patientRef) entries = entries.filter((entry) => entry.patientRef === patientRef);
    return entries.slice(0, limit);
  }

  /** Recomputes the whole chain. Returns the first index that fails, if any. */
  verify() {
    let previousHash = GENESIS;
    for (let i = 0; i < this.chain.length; i += 1) {
      const { sequence, previousHash: storedPrevious, hash, ...body } = this.chain[i];
      const expected = createHash('sha256')
        .update(previousHash)
        .update(AuditService.canonical(body))
        .digest('hex');
      if (storedPrevious !== previousHash || expected !== hash) {
        return { valid: false, brokenAt: sequence, length: this.chain.length };
      }
      previousHash = hash;
    }
    return { valid: true, brokenAt: null, length: this.chain.length, headHash: previousHash };
  }
}

module.exports = new AuditService();
module.exports.AuditService = AuditService;
