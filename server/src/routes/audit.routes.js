'use strict';

const express = require('express');
const { authenticate, requireScope } = require('../middleware/auth');
const asyncHandler = require('../util/asyncHandler');
const audit = require('../services/audit/auditService');
const fhir = require('../services/fhir/fhirClient');

const router = express.Router();

router.get('/', authenticate, requireScope('audit:read'), (req, res) => {
  res.json({
    entries: audit.list({ limit: Number(req.query.limit) || 50 }),
    integrity: audit.verify(),
  });
});

router.get('/integrity', authenticate, requireScope('audit:read'), (req, res) => {
  res.json(audit.verify());
});

/** The raw FHIR AuditEvent resources, for anyone who wants to see the real thing. */
router.get('/fhir', authenticate, requireScope('audit:read'), asyncHandler(async (req, res) => {
  const events = await fhir.recentAuditEvents(Number(req.query.limit) || 25);
  res.json({ total: events.length, events });
}));

module.exports = router;
