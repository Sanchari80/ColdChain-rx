'use strict';

const express = require('express');
const config = require('../config');
const fhir = require('../services/fhir/fhirClient');
const rxnorm = require('../services/rxnorm/rxnormClient');
const notifications = require('../services/notifications/store');
const audit = require('../services/audit/auditService');
const indentService = require('../services/indents/indentService');
const asyncHandler = require('../util/asyncHandler');
const { authenticate, requireScope } = require('../middleware/auth');

const router = express.Router();

router.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    uptimeSeconds: Math.round(process.uptime()),
    time: new Date().toISOString(),
  });
});

/**
 * What the app shows on its system status screen, in the words a ward manager
 * or an administrator would use. No auth: it exposes no clinical data.
 */
router.get('/capabilities', (req, res) => {
  const formulary = rxnorm.snapshotInfo();
  res.json({
    service: 'coldchain-rx',
    version: require('../../package.json').version,
    facility: config.facility,
    dataMode: config.dataMode,
    clinicalRecord: {
      source: config.dataMode === 'live' ? 'Hospital FHIR server' : 'On-premise clinical store',
      endpoint: fhir.baseUrl(),
      release: 'FHIR R4',
    },
    formulary: {
      source: formulary.illustrative ? 'On-premise formulary snapshot' : 'NIH/NLM RxNav',
      updated: formulary.generatedAt || null,
      productCount: formulary.conceptCount ?? null,
      local: Boolean(formulary.illustrative),
    },
    coldChain: config.coldChain,
    standards: [
      'HL7 FHIR R4 MedicationRequest',
      'HL7 FHIR R4 MedicationDispense',
      'HL7 FHIR R4 AuditEvent',
      'HL7 v2.5.1 OMP^O09',
      'RxNorm clinical drug codes',
      'HIPAA Safe Harbor de-identification',
    ],
  });
});

/**
 * Returns the ward queue to the state the service ships with.
 *
 * An administrator action, used when a site is being commissioned or after a
 * training session on a non-clinical instance.
 */
router.post('/system/restore-baseline', authenticate, requireScope('system:manage'), asyncHandler(async (req, res) => {
  notifications.reset();
  audit.reset();
  fhir._resetMock();
  const restored = await indentService.restoreBaseline({ id: req.actor.id, name: req.actor.name, role: req.actor.role });
  res.json({ restored });
}));

module.exports = router;
