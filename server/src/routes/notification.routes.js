'use strict';

const express = require('express');
const { authenticate, requireScope } = require('../middleware/auth');
const { z } = require('zod');
const validate = require('../middleware/validate');
const notifications = require('../services/notifications/store');
const push = require('../services/notifications/push');

const router = express.Router();

const deviceSchema = z.object({
  token: z.string().trim().max(200).refine(push.isValidToken, 'Not an Expo push token'),
  platform: z.enum(['android', 'ios']).optional(),
});

router.get('/', authenticate, requireScope('notification:read'), (req, res) => {
  const ward = req.query.ward || req.actor.ward || undefined;
  const items = notifications.list({ ward, since: req.query.since, limit: Number(req.query.limit) || 50 });
  res.json({ items, unread: notifications.unreadCount(ward) });
});

router.post('/:id/read', authenticate, requireScope('notification:read'), (req, res) => {
  const item = notifications.markRead(req.params.id);
  if (!item) return res.status(404).json({ error: { code: 'not_found', message: 'That alert is no longer in the feed' } });
  return res.json({ item });
});

router.post('/read-all', authenticate, requireScope('notification:read'), (req, res) => {
  const ward = req.query.ward || req.actor.ward || undefined;
  res.json({ marked: notifications.markAllRead(ward) });
});

/**
 * A phone asks to be woken for this person's alerts, including while the app
 * is closed. Registering again is harmless and refreshes the binding.
 */
router.post('/devices', authenticate, requireScope('notification:read'), validate(deviceSchema), (req, res) => {
  const device = push.register(req.body, req.actor);
  res.status(201).json({ registered: true, ward: device.ward || 'all' });
});

/** Signing out on a phone stops its alerts. */
router.post('/devices/remove', authenticate, validate(deviceSchema), (req, res) => {
  res.json({ removed: push.unregister(req.body.token, req.actor) });
});

/**
 * Server-sent events. Chosen over WebSockets because the traffic is one-way,
 * it survives most hospital proxies, and the browser/React Native client
 * reconnects on its own.
 */
router.get('/stream', authenticate, requireScope('notification:read'), (req, res) => {
  const ward = req.query.ward || req.actor.ward || undefined;

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.write(`retry: 4000\n\n`);
  res.write(`event: ready\ndata: ${JSON.stringify({ ward: ward || 'all' })}\n\n`);

  const subscriber = {
    send(record) {
      if (ward && record.ward !== ward) return;
      res.write(`event: alert\ndata: ${JSON.stringify(record)}\n\n`);
    },
    close() {
      res.end();
    },
  };

  const unsubscribe = notifications.subscribe(subscriber);
  const heartbeat = setInterval(() => res.write(': keep-alive\n\n'), 20000);

  req.on('close', () => {
    clearInterval(heartbeat);
    unsubscribe();
  });
});

module.exports = router;
