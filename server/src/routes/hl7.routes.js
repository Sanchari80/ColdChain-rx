'use strict';

const express = require('express');
const { z } = require('zod');
const validate = require('../middleware/validate');
const { authenticate, requireScope } = require('../middleware/auth');
const asyncHandler = require('../util/asyncHandler');
const hl7 = require('../services/hl7/omp09');
const { samples } = require('../services/hl7/samples');
const indentService = require('../services/indents/indentService');

const router = express.Router();

const ingestSchema = z.object({
  message: z.string().min(8, 'An HL7 message is required'),
});

/**
 * Accepts a raw HL7 v2 OMP^O09 from the hospital interface engine.
 *
 * Always answers with an ACK, including when the message is rejected — a
 * sender that never sees an acknowledgement will resend the same order.
 */
router.post('/ingest', authenticate, requireScope('hl7:ingest'), validate(ingestSchema), asyncHandler(async (req, res) => {
  let parsed;
  try {
    parsed = hl7.parse(req.body.message);
  } catch (err) {
    return res.status(400).json({
      error: { code: err.code || 'bad_request', message: err.message, details: err.details },
      ack: hl7.buildAck({}, { accepted: false, errorText: err.message }),
      requestId: req.id,
    });
  }

  const indent = await indentService.upsertFromHl7(parsed, req.actor, req.ip);
  return res.status(201).json({
    indent: indentService.publicView(indent),
    ack: hl7.buildAck(parsed.header, { accepted: true }),
    parsed: {
      header: parsed.header,
      order: parsed.order,
      items: parsed.items,
      notes: parsed.notes,
      observations: parsed.observations,
      // PID is deliberately absent: the parsed patient block stays server-side.
      patientIncluded: false,
    },
  });
}));

const TEMPLATES = {
  valid: { label: 'Standard refrigerated order', category: 'order', note: 'Matches the prescription on the chart exactly.' },
  wrongStrength: { label: 'Strength differs from the prescription', category: 'order', note: 'The safety gate stops this one before it is packed.' },
  wrongDrug: { label: 'Different active ingredient', category: 'order', note: 'A different molecule to the one prescribed.' },
  temperatureExcursion: { label: 'Order with a probe alarm in transit', category: 'order', note: 'Arrives with the transport box already out of range.' },
  wrongMessageType: { label: 'Unsupported message type', category: 'exception', note: 'Rejected with a negative acknowledgement.' },
  missingOrc: { label: 'Missing ORC segment', category: 'exception', note: 'Rejected with a negative acknowledgement.' },
};

/**
 * Order message templates for the interface console.
 *
 * An integration team commissioning an interface needs to be able to send a
 * known-good order through it, and a known-bad one, without waiting for the
 * order system to produce one. Each template is a complete, conformant
 * OMP^O09 built by the same code the parser is exercised against.
 */
router.get('/templates', authenticate, requireScope('hl7:ingest'), (req, res) => {
  res.json({
    templates: Object.entries(samples).map(([key, factory]) => ({
      key,
      label: (TEMPLATES[key] && TEMPLATES[key].label) || key,
      category: (TEMPLATES[key] && TEMPLATES[key].category) || 'order',
      note: (TEMPLATES[key] && TEMPLATES[key].note) || null,
      message: factory(),
    })),
  });
});

module.exports = router;
