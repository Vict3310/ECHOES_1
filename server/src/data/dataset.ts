import fs from 'node:fs';
import path from 'node:path';
import type { Experience, Place } from '../domain/types';

interface PlacesFile {
  places: Place[];
}
interface ExperiencesFile {
  experiences: Experience[];
}

/** Walk up from this module until we find the repository's `data` directory. */
export function repoRoot(startDir: string = __dirname): string {
  let dir = startDir;
  for (let i = 0; i < 8; i += 1) {
    if (fs.existsSync(path.join(dir, 'data', 'places.json'))) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error('Could not locate the repository data directory (data/places.json).');
}

function readJson<T>(file: string): T {
  const full = path.join(repoRoot(), 'data', file);
  return JSON.parse(fs.readFileSync(full, 'utf8')) as T;
}

export function loadPlaces(): Place[] {
  return readJson<PlacesFile>('places.json').places;
}

export function loadExperiences(): Experience[] {
  return readJson<ExperiencesFile>('experiences.json').experiences;
}
