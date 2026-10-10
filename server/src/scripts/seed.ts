/**
 * Database seed.
 *
 * Reference cultural data is version-controlled in /data. This script mirrors it
 * into PostgreSQL for geographic queries (the place_geo table created by
 * prisma/sql/postgis.sql) and optionally creates an administrator account.
 *
 * Run:  npm --workspace server run db:seed
 * Env:  DATABASE_URL (required), SEED_ADMIN_EMAIL + SEED_ADMIN_PASSWORD (optional)
 */
import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcryptjs';
import { loadPlaces } from '../data/dataset';
import { repoRoot } from '../data/dataset';

async function main(): Promise<void> {
  const prisma = new PrismaClient();
  const places = loadPlaces();

  console.log(`Seeding ${places.length} cultural places from ${repoRoot()}/data/places.json`);

  // The PostGIS table is optional: it only exists after postgis.sql has been
  // applied. If it is missing we skip the geographic mirror rather than failing.
  let geoReady = true;
  try {
    await prisma.$executeRawUnsafe('SELECT 1 FROM place_geo LIMIT 1');
  } catch {
    geoReady = false;
    console.warn(
      'place_geo does not exist. Apply prisma/sql/postgis.sql (it needs the PostGIS extension) to enable geographic queries. Skipping the geo mirror.',
    );
  }

  if (geoReady) {
    for (const place of places) {
      await prisma.$executeRawUnsafe(
        `INSERT INTO place_geo (place_id, name, category, geom, updated_at)
         VALUES ($1, $2, $3, ST_SetSRID(ST_MakePoint($4, $5), 4326)::geography, now())
         ON CONFLICT (place_id) DO UPDATE
           SET name = EXCLUDED.name,
               category = EXCLUDED.category,
               geom = EXCLUDED.geom,
               updated_at = now()`,
        place.id,
        place.name,
        place.category,
        place.coordinates.lng,
        place.coordinates.lat,
      );
    }
    console.log(`Mirrored ${places.length} places into place_geo.`);
  }

  const adminEmail = process.env.SEED_ADMIN_EMAIL;
  const adminPassword = process.env.SEED_ADMIN_PASSWORD;
  if (adminEmail && adminPassword) {
    const passwordHash = await bcrypt.hash(adminPassword, 12);
    await prisma.user.upsert({
      where: { email: adminEmail.toLowerCase() },
      update: { role: 'admin', passwordHash },
      create: {
        email: adminEmail.toLowerCase(),
        name: 'ECHOES Administrator',
        passwordHash,
        role: 'admin',
      },
    });
    console.log(`Administrator account ensured for ${adminEmail}.`);
  } else {
    console.log('SEED_ADMIN_EMAIL / SEED_ADMIN_PASSWORD not set — no administrator account was created.');
  }

  await prisma.$disconnect();
}

main().catch(async (error) => {
  console.error('Seed failed:', error);
  process.exitCode = 1;
});
