import path from 'node:path';
import fs from 'node:fs';
import dotenv from 'dotenv';
import { EVENT_RETENTION_DAYS } from './domain/analytics';

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
    provider: str('GEMMA_PROVIDER', 'openai') as 'google' | 'ollama' | 'openai' | 'none',
    model: str('GEMMA_MODEL', 'gpt-4o-mini'),
    googleApiKey: str('GOOGLE_AI_API_KEY', ''),
    googleBaseUrl: str('GOOGLE_AI_BASE_URL', 'https://generativelanguage.googleapis.com/v1beta'),
    openaiApiKey: str('OPENAI_API_KEY', ''),
    openaiBaseUrl: str('OPENAI_BASE_URL', 'https://api.openai.com/v1'),
    ollamaBaseUrl: str('OLLAMA_BASE_URL', 'http://127.0.0.1:11434'),
    timeoutMs: int('GEMMA_TIMEOUT_MS', 30_000),
    maxOutputTokens: int('GEMMA_MAX_OUTPUT_TOKENS', 1024),
  },

  culturalData: {
    wikipediaApiUrl: str('WIKIPEDIA_API_URL', 'https://en.wikipedia.org/w/api.php'),
    wikidataApiUrl: str('WIKIDATA_API_URL', 'https://www.wikidata.org/w/api.php'),
    userAgent: str('WIKIMEDIA_USER_AGENT', 'ECHOES/0.1 (contact@example.org)'),
  },

  /**
   * Outbound email.
   *
   * `log` writes the message to the logger so development and tests never need a
   * provider account; `sendbyte` posts to SendByte's transactional API
   * (https://api.sendbyte.africa/v1/emails), which is hosted in Africa and priced
   * in naira; `none` refuses to send and says so.
   *
   * There is deliberately no silent "sent" state. A sandbox key is reported as a
   * sandbox send, never as a delivery, because SendByte captures sandbox mail
   * instead of delivering it.
   */
  email: {
    transport: str('MAIL_TRANSPORT', 'log') as 'log' | 'sendbyte' | 'none',
    from: str('EMAIL_FROM', 'ECHOES <no-reply@example.org>'),
    sendbyteApiKey: str('SENDBYTE_API_KEY', ''),
    sendbyteBaseUrl: str('SENDBYTE_BASE_URL', 'https://api.sendbyte.africa'),
  },

  /** Absolute base URL used to build links inside emails. */
  appBaseUrl: str('APP_BASE_URL', 'http://localhost:5173'),

  /**
   * Local image storage for guide photographs. Fine for a single instance; a
   * multi-instance deployment needs object storage, because a file written on one
   * host is invisible to the others.
   */
  uploads: {
    dir: str('UPLOADS_DIR', 'uploads'),
    publicPath: str('UPLOADS_PUBLIC_PATH', '/uploads'),
    maxBytes: int('UPLOADS_MAX_BYTES', 5 * 1024 * 1024),
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

  /**
   * First-party analytics.
   *
   * `timezone` is the zone every day boundary, chart axis and "today" figure is
   * computed in, so a report does not change meaning depending on where the
   * reader sits. `requireConsent` makes the browser tracker wait for an explicit
   * opt-in before it sends anything.
   */
  analytics: {
    timezone: str('ANALYTICS_TIMEZONE', 'Africa/Lagos'),
    retentionDays: int('ANALYTICS_RETENTION_DAYS', EVENT_RETENTION_DAYS),
    requireConsent: str('ANALYTICS_REQUIRE_CONSENT', 'false') === 'true',
  },

  /**
   * Extra gate on administrative data.
   *
   * The shared admin token still works for break-glass access; when this list is
   * set, an ordinary admin session must also match one of these addresses, so a
   * stolen admin cookie alone is not enough. Roles themselves are never
   * self-assignable — registration only ever grants `visitor` or `organizer`.
   */
  adminEmails: str('ADMIN_EMAILS', '')
    .split(',')
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean),

  /** Budget guard rails for AI spend, in USD micros (1_000_000 = $1). */
  aiBudget: {
    dailyMicros: int('AI_DAILY_BUDGET_MICROS', 5_000_000),
    monthlyMicros: int('AI_MONTHLY_BUDGET_MICROS', 50_000_000),
    alertThresholdPercent: int('AI_BUDGET_ALERT_PERCENT', 80),
  },
};

export function gemmaConfigured(): boolean {
  if (env.gemma.provider === 'google') return env.gemma.googleApiKey.length > 0;
  if (env.gemma.provider === 'openai') return env.gemma.openaiApiKey.length > 0;
  if (env.gemma.provider === 'ollama') return env.gemma.ollamaBaseUrl.length > 0;
  return false;
}

export function alatpayConfigured(): boolean {
  return Boolean(env.alatpay.secretKey && env.alatpay.publicKey && env.alatpay.businessId);
}

export function databaseConfigured(): boolean {
  return env.databaseUrl.length > 0 && !env.isTest;
}
