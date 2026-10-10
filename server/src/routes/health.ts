import { Router } from 'express';
import { databaseConfigured, env, gemmaConfigured } from '../env';
import { asyncHandler, ok } from '../lib/http';
import { createGemmaProvider } from '../services/gemma/providers';
import { alatpayStatus } from '../services/payments/alatpay';
import { createRepository } from '../repo';

export const healthRouter = Router();

healthRouter.get(
  '/health',
  asyncHandler(async (_req, res) => {
    const provider = createGemmaProvider();
    const gemmaHealth = env.isTest
      ? { ok: gemmaConfigured(), message: 'skipped in tests' }
      : await provider.health();

    const repo = createRepository();

    ok(res, {
      status: 'ok',
      time: new Date().toISOString(),
      uptimeSeconds: Math.round(process.uptime()),
      store: databaseConfigured() ? 'postgres' : 'memory',
      samplePlacesLoaded: (await repo.listPlaces({ limit: 1 })).length > 0,
      integrations: {
        gemma: {
          primaryModel: 'Gemma',
          provider: env.gemma.provider,
          model: env.gemma.model,
          configured: gemmaConfigured(),
          healthy: gemmaHealth.ok,
          detail: gemmaHealth.message,
        },
        routing: {
          provider: env.routing.provider,
          baseUrl:
            env.routing.provider === 'osrm' ? env.routing.osrmBaseUrl : env.routing.graphhopperBaseUrl,
          productionReady: !env.routing.osrmBaseUrl.includes('router.project-osrm.org'),
        },
        alatpay: alatpayStatus(),
        database: {
          configured: databaseConfigured(),
          note: databaseConfigured()
            ? 'PostgreSQL is configured for transactional data.'
            : 'No DATABASE_URL: transactional data is held in memory and resets on restart.',
        },
        tileProvider: {
          note: 'Map tiles are loaded by the browser. Review the tile provider terms before production use.',
        },
      },
    });
  }),
);
