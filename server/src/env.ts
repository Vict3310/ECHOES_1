import path from 'node:path';
import fs from 'node:fs';
import dotenv from 'dotenv';

const candidates = [
  path.resolve(process.cwd(), '.env'),
  path.resolve(process.cwd(), '..', '.env'),
];
for (const candidate of candidates) {
  if (fs.existsSync(candidate)) {
    dotenv.config({ path: candidate });
    break;
  }
}

function str(name: string, fallback = ''): string {
  const value = process.env[name];
  return value === undefined || value === '' ? fallback : value;
}

function int(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export const env = {
  nodeEnv: str('NODE_ENV', 'development'),
  isProduction: str('NODE_ENV', 'development') === 'production',
  isTest: str('NODE_ENV', '') === 'test',
  port: int('PORT', 8787),
  corsOrigins: str('CORS_ORIGINS', 'http://localhost:5173')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean),

  databaseUrl: str('DATABASE_URL', ''),
  sessionSecret: str('SESSION_SECRET', 'dev-only-insecure-session-secret-change-me'),
  adminApiToken: str('ADMIN_API_TOKEN', ''),

  gemma: {
    provider: str('GEMMA_PROVIDER', 'none') as 'google' | 'ollama' | 'none',
    model: str('GEMMA_MODEL', 'gemma3:4b'),
    googleApiKey: str('GOOGLE_AI_API_KEY', ''),
    googleBaseUrl: str('GOOGLE_AI_BASE_URL', 'https://generativelanguage.googleapis.com/v1beta'),
    ollamaBaseUrl: str('OLLAMA_BASE_URL', 'http://127.0.0.1:11434'),
    timeoutMs: int('GEMMA_TIMEOUT_MS', 30_000),
    maxOutputTokens: int('GEMMA_MAX_OUTPUT_TOKENS', 1024),
  },

  culturalData: {
    wikipediaApiUrl: str('WIKIPEDIA_API_URL', 'https://en.wikipedia.org/w/api.php'),
    wikidataApiUrl: str('WIKIDATA_API_URL', 'https://www.wikidata.org/w/api.php'),
    userAgent: str('WIKIMEDIA_USER_AGENT', 'ECHOES/0.1 (contact@example.org)'),
  },

  routing: {
    provider: str('ROUTING_PROVIDER', 'osrm') as 'osrm' | 'graphhopper',
    osrmBaseUrl: str('OSRM_BASE_URL', 'https://router.project-osrm.org'),
    graphhopperApiKey: str('GRAPHHOPPER_API_KEY', ''),
    graphhopperBaseUrl: str('GRAPHHOPPER_BASE_URL', 'https://graphhopper.com/api/1'),
    timeoutMs: int('ROUTING_TIMEOUT_MS', 8000),
  },

  alatpay: {
    environment: str('ALATPAY_ENV', 'sandbox') as 'sandbox' | 'live',
    baseUrl: str('ALATPAY_BASE_URL', 'https://api.alatpay.com'),
    publicKey: str('ALATPAY_PUBLIC_KEY', ''),
    secretKey: str('ALATPAY_SECRET_KEY', ''),
    businessId: str('ALATPAY_BUSINESS_ID', ''),
    callbackUrl: str('ALATPAY_CALLBACK_URL', 'http://localhost:5173/experiences/booking/return'),
    webhookSecret: str('ALATPAY_WEBHOOK_SECRET', ''),
    // REST paths come from the current ALATPay documentation for your merchant
    // account. No default is assumed, so ECHOES cannot silently call an endpoint
    // that does not exist. See .env.example.
    initPath: str('ALATPAY_INIT_PATH', ''),
    verifyPath: str('ALATPAY_VERIFY_PATH', ''),
    allowSimulation: str('ALATPAY_ALLOW_SIMULATION', 'false') === 'true',
  },

  currency: str('CURRENCY', 'NGN'),
};

export function gemmaConfigured(): boolean {
  if (env.gemma.provider === 'google') return env.gemma.googleApiKey.length > 0;
  if (env.gemma.provider === 'ollama') return env.gemma.ollamaBaseUrl.length > 0;
  return false;
}

export function alatpayConfigured(): boolean {
  return Boolean(env.alatpay.secretKey && env.alatpay.publicKey && env.alatpay.businessId);
}

export function databaseConfigured(): boolean {
  return env.databaseUrl.length > 0 && !env.isTest;
}
