'use strict';

const os = require('node:os');
const config = require('./config');
const logger = require('./util/logger');
const { createApp } = require('./app');
const indentService = require('./services/indents/indentService');
const coldChain = require('./services/coldchain/monitor');

async function main() {
  const app = createApp();

  if (config.dataMode === 'mock') {
    const seeded = await indentService.restoreBaseline();
    logger.info('ward.queue.restored', { indents: seeded });
  }

  // Probe tick. In a real deployment this is replaced by readings pushed from
  // the transport box's temperature logger.
  const ticker = setInterval(() => {
    for (const indentId of coldChain.activeTripIds()) coldChain.sample(indentId);
  }, config.coldChain.sampleSeconds * 1000);
  ticker.unref();

  const server = app.listen(config.port, config.host, () => {
    const addresses = Object.values(os.networkInterfaces())
      .flat()
      .filter((entry) => entry && entry.family === 'IPv4' && !entry.internal)
      .map((entry) => entry.address);

    logger.info('server.listening', {
      port: config.port,
      dataMode: config.dataMode,
      lan: addresses.map((address) => `http://${address}:${config.port}`),
    });
  });

  const shutdown = (signal) => {
    logger.info('server.shutdown', { signal });
    clearInterval(ticker);
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(1), 8000).unref();
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('unhandledRejection', (reason) => logger.error('unhandled.rejection', { reason: String(reason) }));
}

main().catch((err) => {
  logger.error('server.start.failed', { message: err.message, stack: err.stack });
  process.exit(1);
});
