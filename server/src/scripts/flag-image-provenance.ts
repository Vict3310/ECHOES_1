/**
 * Marks how each place image may honestly be described, and makes the stored
 * `coverage.image` row agree with what the interface actually renders.
 *
 * Two very different things were sitting in `image` with identical shape:
 *
 *   - a freely licensed photograph of the place itself, resolved from a cited
 *     Wikimedia article and re-encoded locally (`client/public/places/…`);
 *   - a representative stock photograph from a third-party CDN that is *not*
 *     a photograph of that place.
 *
 * Presenting those as the same thing is exactly the kind of quiet overstatement
 * this dataset is meant to avoid, so each image now carries `depicts`:
 *
 *   place          — a confirmed, openly licensed photograph of the place
 *   representative — a stock image shown for atmosphere, labelled in the UI
 *
 * The coverage row is then derived from that flag, so a place can never claim
 * an image dimension it does not have, or deny one it does.
 *
 * Run:  npx tsx src/scripts/flag-image-provenance.ts [--write]
 * Without --write it reports what it would change.
 */
import fs from 'node:fs';
import path from 'node:path';
import { repoRoot } from '../data/dataset';

type Depicts = 'place' | 'representative';

interface PlaceImage {
  localPath: string;
  license?: string;
  artist?: string | null;
  credit?: string | null;
  depicts?: Depicts;
  [key: string]: unknown;
}

interface Place {
  id: string;
  image?: PlaceImage | null;
  coverage: Record<string, { status: string; evidence: string }>;
}

const PLACE_EVIDENCE =
  'A freely licensed photograph of this place is published on Wikimedia Commons and is shown with its author and licence.';

const REPRESENTATIVE_EVIDENCE =
  'No openly licensed photograph of this place was confirmed in the sources that were checked. The image shown is a representative stock photograph, not a photograph of this place.';

const NO_IMAGE_EVIDENCE =
  'No openly licensed image from the checked sources was confirmed for reuse.';

/** Local files were resolved from cited articles; remote URLs were never verified to depict the place. */
function depictsFor(image: PlaceImage): Depicts {
  return image.localPath.startsWith('http') ? 'representative' : 'place';
}

function main(): void {
  const write = process.argv.includes('--write');
  const file = path.join(repoRoot(), 'data', 'places.json');
  const raw = JSON.parse(fs.readFileSync(file, 'utf8')) as { places: Place[] };

  const counts: Record<Depicts | 'none', number> = { place: 0, representative: 0, none: 0 };
  const changed: string[] = [];

  for (const place of raw.places) {
    const image = place.image ?? null;
    const before = JSON.stringify({ image: place.image, coverage: place.coverage.image });

    if (!image) {
      counts.none += 1;
      place.coverage.image = { status: 'missing', evidence: NO_IMAGE_EVIDENCE };
    } else {
      const depicts = depictsFor(image);
      counts[depicts] += 1;
      image.depicts = depicts;
      place.coverage.image =
        depicts === 'place'
          ? { status: 'available', evidence: PLACE_EVIDENCE }
          : { status: 'missing', evidence: REPRESENTATIVE_EVIDENCE };
    }

    if (JSON.stringify({ image: place.image, coverage: place.coverage.image }) !== before) {
      changed.push(place.id);
    }
  }

  console.log(
    `places: ${raw.places.length} — photographs of the place: ${counts.place}, ` +
      `representative stock: ${counts.representative}, no image: ${counts.none}`,
  );
  console.log(`records changed: ${changed.length}`);

  if (!write) {
    console.log('dry run — pass --write to update data/places.json');
    return;
  }

  fs.writeFileSync(file, `${JSON.stringify(raw, null, 2)}\n`, 'utf8');
  console.log(`wrote ${path.relative(repoRoot(), file)}`);
}

main();
