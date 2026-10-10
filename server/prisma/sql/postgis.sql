-- ============================================================================
-- ECHOES — optional PostGIS enhancement
-- Apply AFTER `npx prisma migrate deploy`, against a database with the PostGIS
-- extension available (e.g. `CREATE EXTENSION IF NOT EXISTS postgis;`).
--
-- Reference places live in version-controlled JSON, but when they are also
-- mirrored into Postgres (see prisma/seed.ts -> `place_geo`) these columns let
-- the API run real geographic queries (radius search, map bounding box).
--
-- Every statement is idempotent and safe to re-run.
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS postgis;

CREATE TABLE IF NOT EXISTS place_geo (
  place_id   TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  category   TEXT NOT NULL,
  geom       GEOGRAPHY(POINT, 4326) NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS place_geo_geom_idx ON place_geo USING GIST (geom);
CREATE INDEX IF NOT EXISTS place_geo_category_idx ON place_geo (category);

-- Places within `radius_m` metres of a point, nearest first.
CREATE OR REPLACE FUNCTION places_near(
  in_lat DOUBLE PRECISION,
  in_lng DOUBLE PRECISION,
  radius_m INTEGER DEFAULT 5000,
  max_rows INTEGER DEFAULT 50
)
RETURNS TABLE (
  place_id TEXT,
  name     TEXT,
  category TEXT,
  distance_m DOUBLE PRECISION
)
LANGUAGE sql
STABLE
AS $$
  SELECT
    g.place_id,
    g.name,
    g.category,
    ST_Distance(g.geom, ST_SetSRID(ST_MakePoint(in_lng, in_lat), 4326)::geography) AS distance_m
  FROM place_geo g
  WHERE ST_DWithin(
    g.geom,
    ST_SetSRID(ST_MakePoint(in_lng, in_lat), 4326)::geography,
    radius_m
  )
  ORDER BY distance_m ASC
  LIMIT max_rows;
$$;
