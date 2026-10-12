-- ============================================================================
-- ECHOES — analytics, AI cost log, request metrics and account status
--
-- Apply AFTER `npx prisma migrate deploy` (or `npx prisma migrate dev`, which
-- generates equivalent DDL from schema.prisma). Every statement is idempotent,
-- so re-running this file is safe.
--
-- Why this file exists alongside the Prisma schema: Prisma models the data, but
-- two things it cannot express are stated here — the partial/covering indexes
-- the analytics read patterns actually use, and the trigger that makes the audit
-- trail append-only. Keeping them in reviewable SQL means the guarantee is
-- visible in a pull request instead of implied.
--
-- Order of operations for a production deploy:
--   1. npx prisma migrate deploy          (creates tables/columns from schema)
--   2. psql "$DATABASE_URL" -f prisma/sql/analytics.sql
-- Both steps are additive; no existing row is modified or removed.
-- ============================================================================

-- --- Account status ---------------------------------------------------------

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'UserStatus') THEN
    CREATE TYPE "UserStatus" AS ENUM ('active', 'suspended');
  END IF;
END
$$;

ALTER TABLE "User"
  ADD COLUMN IF NOT EXISTS "status" "UserStatus" NOT NULL DEFAULT 'active',
  ADD COLUMN IF NOT EXISTS "suspendedAt" TIMESTAMP(3);

CREATE INDEX IF NOT EXISTS "User_status_createdAt_idx" ON "User" ("status", "createdAt");
CREATE INDEX IF NOT EXISTS "User_createdAt_idx" ON "User" ("createdAt");

-- --- Analytics events -------------------------------------------------------

CREATE TABLE IF NOT EXISTS "AnalyticsEvent" (
  id           TEXT PRIMARY KEY,
  name         TEXT NOT NULL,
  "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT now(),
  "occurredAt" TIMESTAMP(3) NOT NULL,
  "visitorId"  TEXT,
  "sessionId"  TEXT,
  "userId"     TEXT,
  path         TEXT,
  "resourceId" TEXT,
  "utmSource"  TEXT,
  "utmMedium"  TEXT,
  "utmCampaign" TEXT,
  device       TEXT NOT NULL DEFAULT 'unknown',
  props        JSONB NOT NULL DEFAULT '{}',
  internal     BOOLEAN NOT NULL DEFAULT false
);

-- The dashboard always filters by a date range first, then by event name.
CREATE INDEX IF NOT EXISTS "AnalyticsEvent_occurredAt_idx" ON "AnalyticsEvent" ("occurredAt");
CREATE INDEX IF NOT EXISTS "AnalyticsEvent_name_occurredAt_idx" ON "AnalyticsEvent" ("name", "occurredAt");
CREATE INDEX IF NOT EXISTS "AnalyticsEvent_visitorId_occurredAt_idx" ON "AnalyticsEvent" ("visitorId", "occurredAt");
CREATE INDEX IF NOT EXISTS "AnalyticsEvent_sessionId_idx" ON "AnalyticsEvent" ("sessionId");
CREATE INDEX IF NOT EXISTS "AnalyticsEvent_userId_occurredAt_idx" ON "AnalyticsEvent" ("userId", "occurredAt");
CREATE INDEX IF NOT EXISTS "AnalyticsEvent_resourceId_occurredAt_idx" ON "AnalyticsEvent" ("resourceId", "occurredAt");
-- Excluding internal traffic is a first-class filter, not an afterthought.
CREATE INDEX IF NOT EXISTS "AnalyticsEvent_internal_occurredAt_idx" ON "AnalyticsEvent" ("internal", "occurredAt");

-- --- AI request log ---------------------------------------------------------

CREATE TABLE IF NOT EXISTS "AiRequest" (
  id                  TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  feature             TEXT NOT NULL,
  model               TEXT NOT NULL,
  provider            TEXT NOT NULL,
  ok                  BOOLEAN NOT NULL,
  status              INTEGER NOT NULL,
  "latencyMs"         INTEGER NOT NULL,
  "promptTokens"      INTEGER,
  "completionTokens"  INTEGER,
  "providerCostMinor" INTEGER,
  "estimatedCostMicros" INTEGER,
  "errorKind"         TEXT,
  "createdAt"         TIMESTAMP(3) NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "AiRequest_createdAt_idx" ON "AiRequest" ("createdAt");
CREATE INDEX IF NOT EXISTS "AiRequest_feature_createdAt_idx" ON "AiRequest" ("feature", "createdAt");
CREATE INDEX IF NOT EXISTS "AiRequest_model_createdAt_idx" ON "AiRequest" ("model", "createdAt");

-- --- Request metrics (per minute, per route) --------------------------------

CREATE TABLE IF NOT EXISTS "RequestMetric" (
  id             TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  bucket         TIMESTAMP(3) NOT NULL,
  route          TEXT NOT NULL,
  method         TEXT NOT NULL,
  count          INTEGER NOT NULL DEFAULT 0,
  "serverErrors" INTEGER NOT NULL DEFAULT 0,
  "clientErrors" INTEGER NOT NULL DEFAULT 0,
  "latencySumMs" INTEGER NOT NULL DEFAULT 0,
  "latencyMaxMs" INTEGER NOT NULL DEFAULT 0,
  histogram      INTEGER[] NOT NULL DEFAULT '{}'
);

CREATE UNIQUE INDEX IF NOT EXISTS "RequestMetric_bucket_route_method_key"
  ON "RequestMetric" (bucket, route, method);
CREATE INDEX IF NOT EXISTS "RequestMetric_bucket_idx" ON "RequestMetric" (bucket);

-- --- Audit trail is append-only ---------------------------------------------
--
-- An administrator with write access to the database could otherwise rewrite
-- history and leave no trace of having done so. The trigger makes UPDATE and
-- DELETE fail loudly. Deliberate maintenance (for example a lawful erasure
-- request) has to disable the trigger explicitly, which is itself auditable.

CREATE OR REPLACE FUNCTION echoes_audit_log_immutable()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'AuditLog is append-only: % is refused. Disable the echoes_audit_log_immutable trigger deliberately if a lawful erasure requires it.', TG_OP
    USING ERRCODE = 'restrict_violation';
END;
$$;

DROP TRIGGER IF EXISTS echoes_audit_log_no_update ON "AuditLog";
CREATE TRIGGER echoes_audit_log_no_update
  BEFORE UPDATE OR DELETE ON "AuditLog"
  FOR EACH ROW EXECUTE FUNCTION echoes_audit_log_immutable();

-- --- Retention --------------------------------------------------------------
--
-- Raw events are pruned by the API (ANALYTICS_RETENTION_DAYS, default 400). If
-- you prefer the database to enforce it, schedule the statements below with
-- pg_cron or your platform's scheduler:
--
--   DELETE FROM "AnalyticsEvent" WHERE "occurredAt" < now() - interval '400 days';
--   DELETE FROM "RequestMetric"  WHERE bucket        < now() - interval '400 days';
--
-- Audit rows and payment records are deliberately excluded from retention.
