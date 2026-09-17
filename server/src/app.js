'use strict';

const fs = require('node:fs');
const path = require('node:path');
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');

const config = require('./config');
const logger = require('./util/logger');
const requestId = require('./middleware/requestId');
const { errorHandler, notFoundHandler } = require('./middleware/errorHandler');
const routes = require('./routes');

function createApp() {
  const app = express();

  // Behind a hospital load balancer the real client IP arrives in a header;
  // rate limiting and audit records need it to be accurate.
  app.set('trust proxy', 1);
  app.disable('x-powered-by');

  app.use(helmet({
    contentSecurityPolicy: false, // This service answers JSON only.
    crossOriginResourcePolicy: { policy: 'cross-origin' },
  }));

  app.use(cors({
    origin: true,
    credentials: false,
    methods: ['GET', 'POST', 'PUT', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-Id'],
  }));

  app.use(express.json({ limit: '256kb' }));
  app.use(express.text({ type: ['text/plain', 'application/hl7-v2'], limit: '256kb' }));
  app.use(requestId);

  app.use((req, res, next) => {
    const startedAt = process.hrtime.bigint();
    res.on('finish', () => {
      const ms = Number(process.hrtime.bigint() - startedAt) / 1e6;
      logger.info('request', {
        requestId: req.id,
        method: req.method,
        path: req.path,
        status: res.statusCode,
        ms: Number(ms.toFixed(1)),
      });
    });
    next();
  });

  app.use('/api/v1', routes);

  // The web build of the app, when one has been exported next to the service.
  // One address then serves both the app and the API it talks to.
  const webDir = path.resolve(__dirname, '..', config.webDist);
  if (fs.existsSync(path.join(webDir, 'index.html'))) {
    // Bundles and assets carry a content hash in their name, so they can be
    // cached for good. index.html must not be, or a new release goes unseen.
    app.use(express.static(webDir, {
      index: 'index.html',
      setHeaders: (res, filePath) => {
        const hashed = /[\\/](_expo|assets)[\\/]/.test(filePath);
        res.setHeader('Cache-Control', hashed ? 'public, max-age=31536000, immutable' : 'no-cache');
      },
    }));
    app.get(/^\/(?!api\/).*/, (req, res) => {
      res.setHeader('Cache-Control', 'no-cache');
      res.sendFile(path.join(webDir, 'index.html'));
    });
  } else {
    app.get('/', (req, res) => {
      res.json({ service: 'coldchain-rx', docs: '/api/v1/capabilities', dataMode: config.dataMode });
    });
  }

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}

module.exports = { createApp };
