'use strict';

const express = require('express');
const { authenticate, requireScope } = require('../middleware/auth');
const monitor = require('../services/coldchain/monitor');

const router = express.Router();

router.get('/:indentId', authenticate, requireScope('indent:read'), (req, res) => {
  const summary = monitor.summary(req.params.indentId);
  if (!summary) {
    return res.status(404).json({ error: { code: 'not_found', message: 'No cold-chain trip has started for that indent' } });
  }
  return res.json({
    summary,
    readings: monitor.readings(req.params.indentId, Number(req.query.limit) || 60),
  });
});

module.exports = router;
