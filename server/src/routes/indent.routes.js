'use strict';

const express = require('express');
const { z } = require('zod');
const validate = require('../middleware/validate');
const { authenticate, requireScope } = require('../middleware/auth');
const asyncHandler = require('../util/asyncHandler');
const indentService = require('../services/indents/indentService');

const router = express.Router();

const listQuery = z.object({
  ward: z.string().trim().max(24).optional(),
  status: z.string().trim().max(64).optional(),
});

const dispenseSchema = z.object({
  courierId: z.string().trim().max(24).optional(),
  overrideReason: z.string().trim().min(8, 'Explain the override in at least a few words').max(280).optional(),
  forceExcursion: z.boolean().optional(),
});

const deliverSchema = z.object({
  receivedBy: z.object({
    id: z.string().trim().max(32),
    name: z.string().trim().max(80),
    role: z.string().trim().max(40),
  }).optional(),
});

const cancelSchema = z.object({
  reason: z.string().trim().min(4).max(280),
});

/**
 * The queue, narrowed to what this role is allowed to see.
 *
 * A ward nurse sees their own ward. A courier sees the trips assigned to them
 * and nothing else. Pharmacy and administration see the whole board. The
 * narrowing happens here rather than in the app, so a client cannot widen it.
 */
router.get('/', authenticate, requireScope('indent:read'), validate(listQuery, 'query'), (req, res) => {
  const { ward, status } = req.validatedQuery;
  const scopedWard = req.actor.role === 'nurse' ? req.actor.ward : (ward || undefined);
  let items = indentService.list({ ward: scopedWard || undefined, status });

  if (req.actor.role === 'courier') {
    items = items.filter((item) => item.delivery && item.delivery.courier && item.delivery.courier.id === req.actor.id);
  }

  res.json({ items, scope: { role: req.actor.role, ward: scopedWard || null } });
});

router.get('/couriers', authenticate, requireScope('indent:read'), (req, res) => {
  res.json({ couriers: indentService.couriers() });
});

router.get('/:id', authenticate, requireScope('indent:read'), (req, res) => {
  res.json({ indent: indentService.get(req.params.id) });
});

router.post('/:id/verify', authenticate, requireScope('indent:verify'), asyncHandler(async (req, res) => {
  const indent = await indentService.verify(req.params.id, req.actor, req.ip);
  res.json({ indent: indentService.publicView(indent) });
}));

router.post('/:id/dispense', authenticate, requireScope('indent:dispense'), validate(dispenseSchema), asyncHandler(async (req, res) => {
  const indent = await indentService.dispense(req.params.id, req.body, req.actor, req.ip);
  res.status(201).json({ indent: indentService.publicView(indent) });
}));

router.post('/:id/receive', authenticate, requireScope('indent:receive'), validate(deliverSchema), asyncHandler(async (req, res) => {
  const indent = await indentService.markDelivered(req.params.id, req.body, req.actor, req.ip);
  res.json({ indent: indentService.publicView(indent) });
}));

router.post('/:id/cancel', authenticate, requireScope('indent:cancel'), validate(cancelSchema), asyncHandler(async (req, res) => {
  const indent = await indentService.cancel(req.params.id, req.body, req.actor, req.ip);
  res.json({ indent: indentService.publicView(indent) });
}));

module.exports = router;
