/**
 * Offline sample.
 *
 * The canonical cultural dataset lives at /data/places.json in the repository
 * and is served by the API. This bundled copy exists ONLY so that the interface
 * can still be explored when the API is unreachable — it is always displayed
 * behind an "offline sample" banner, and it is never presented as live data.
 */
import rawPlaces from '../../../data/places.json';
import type { Place } from '../lib/types';

interface PlacesFile {
  retrievedAt: string;
  places: unknown[];
}

const file = rawPlaces as unknown as PlacesFile;

export const FALLBACK_RETRIEVED_AT = file.retrievedAt;
export const FALLBACK_PLACES = file.places as Place[];

export const FALLBACK_NOTICE =
  'Offline sample: the ECHOES API could not be reached, so these records are read from the bundled dataset. Moderation state, availability and AI answers are unavailable in this mode.';
