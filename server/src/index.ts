import { createApp } from './app';
import { env, gemmaConfigured, databaseConfigured } from './env';
import { logger } from './lib/logger';
import { flushRequestMetrics } from './middleware/metrics';
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
      analyticsTimezone: env.analytics.timezone,
      analyticsRetentionDays: env.analytics.retentionDays,
      analyticsConsentRequired: env.analytics.requireConsent,
    },
    'ECHOES API listening',
  );
});

async function shutdown(signal: string): Promise<void> {
  logger.info({ signal }, 'Shutting down');
  // The last minute of request metrics would otherwise be lost.
  await flushRequestMetrics().catch(() => undefined);
  server.close(() => process.exit(0));
}

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
