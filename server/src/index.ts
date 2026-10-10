import { createApp } from './app';
import { env, gemmaConfigured, databaseConfigured } from './env';
import { logger } from './lib/logger';
import { alatpayStatus } from './services/payments/alatpay';

const app = createApp();

const server = app.listen(env.port, () => {
  logger.info(
    {
      port: env.port,
      environment: env.nodeEnv,
      store: databaseConfigured() ? 'postgres' : 'memory',
      gemma: gemmaConfigured() ? `${env.gemma.provider}:${env.gemma.model}` : 'not configured (offline retrieval)',
      routing: env.routing.provider,
      alatpay: alatpayStatus().configured ? `${alatpayStatus().environment} (live credentials present)` : 'not configured',
    },
    'ECHOES API listening',
  );
});

function shutdown(signal: string): void {
  logger.info({ signal }, 'Shutting down');
  server.close(() => process.exit(0));
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
