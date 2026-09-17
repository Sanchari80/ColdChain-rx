'use strict';

const express = require('express');

const router = express.Router();

router.use('/auth', require('./auth.routes'));
router.use('/directory', require('./directory.routes'));
router.use('/indents', require('./indent.routes'));
router.use('/hl7', require('./hl7.routes'));
router.use('/notifications', require('./notification.routes'));
router.use('/audit', require('./audit.routes'));
router.use('/coldchain', require('./coldchain.routes'));
router.use('/', require('./meta.routes'));

module.exports = router;
