'use strict';

const express = require('express');
const { z } = require('zod');
const validate = require('../middleware/validate');
const { authenticate, requireScope } = require('../middleware/auth');
const asyncHandler = require('../util/asyncHandler');
const directory = require('../services/identity/directory');
const audit = require('../services/audit/auditService');

const router = express.Router();

/**
 * Account administration.
 *
 * The only way an account comes into existence. Restricted to the
 * "directory:manage" scope, which only a system administrator account carries,
 * and every change is written to the same hash-chained audit trail as clinical
 * activity — creating access to patient-adjacent data is itself an auditable
 * event.
 */

const provisionSchema = z.object({
  id: z.string().trim().min(3).max(32).regex(/^[A-Za-z0-9-]+$/, 'A staff ID is letters, digits and hyphens'),
  name: z.string().trim().min(2).max(80),
  role: z.enum(['nurse', 'pharmacist', 'courier', 'admin']),
  ward: z.string().trim().max(24).optional(),
  department: z.string().trim().max(80).optional(),
  ssoSubject: z.string().trim().max(120).optional(),
  pin: z.string().trim().min(4).max(12).optional(),
});

const statusSchema = z.object({
  status: z.enum(['active', 'suspended']),
});

router.get('/', authenticate, requireScope('directory:read'), (req, res) => {
  res.json({
    accounts: directory.list(),
    roles: Object.keys(directory.ROLE_SCOPES)
      .filter((role) => role !== 'system')
      .map((role) => ({ role, title: directory.ROLE_TITLES[role], scopes: directory.ROLE_SCOPES[role] })),
  });
});

router.post('/', authenticate, requireScope('directory:manage'), validate(provisionSchema), asyncHandler(async (req, res) => {
  const { account, issuedPin } = directory.provision(req.body, req.actor);
  await audit.record({
    action: 'C',
    subtypeCode: 'create',
    subtypeDisplay: 'Staff account provisioned',
    actor: { id: req.actor.id, role: req.actor.role, name: req.actor.name },
    sourceIp: req.ip,
    summary: `${req.actor.id} provisioned ${account.id} as ${account.title}`,
  });
  // The issued PIN is returned once, to the administrator who created it, so it
  // can be handed to the member of staff. It is not stored in readable form.
  res.status(201).json({ account, issuedPin });
}));

router.post('/:id/status', authenticate, requireScope('directory:manage'), validate(statusSchema), asyncHandler(async (req, res) => {
  const account = directory.setStatus(req.params.id, req.body.status, req.actor);
  await audit.record({
    action: 'U',
    subtypeCode: 'update',
    subtypeDisplay: 'Staff account status changed',
    actor: { id: req.actor.id, role: req.actor.role, name: req.actor.name },
    sourceIp: req.ip,
    summary: `${req.actor.id} set ${account.id} to ${account.status}`,
  });
  res.json({ account });
}));

router.post('/:id/pin-reset', authenticate, requireScope('directory:manage'), asyncHandler(async (req, res) => {
  const { account, issuedPin } = directory.resetPin(req.params.id);
  await audit.record({
    action: 'U',
    subtypeCode: 'update',
    subtypeDisplay: 'Credential reissued',
    actor: { id: req.actor.id, role: req.actor.role, name: req.actor.name },
    sourceIp: req.ip,
    summary: `${req.actor.id} reissued the PIN for ${account.id}`,
  });
  res.json({ account, issuedPin });
}));

module.exports = router;
