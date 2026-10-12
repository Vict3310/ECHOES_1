/**
 * Refresh and verify citation provenance across the curated dataset.
 *
 * For every record's citations this asks the Wikimedia API whether the cited page
 * still exists, and records the verdict (`found` plus `checkedAt`). It also reports
 * coordinate drift between a record and its article, and flags duplicate
 * candidates for human review — it never merges or deletes anything.
 *
 * Run:
 *   npx tsx src/scripts/ingest.ts                     # report only, no writes
 *   npx tsx src/scripts/ingest.ts --write             # record the verdicts
 *   npx tsx src/scripts/ingest.ts --place jaekel-house --write
 *   npx tsx src/scripts/ingest.ts --limit 10 --delay 500
 *
 * Exit codes: 0 when every check that was attempted produced an answer, 1 when the
 * run was partial (a citation could not be checked) or the report was written but
 * errors occurred. A partial run is never reported as success.
 */
import fs from 'node:fs';
import path from 'node:path';
import { loadPlaces, repoRoot } from '../data/dataset';
import { runIngestion, type IngestionReport } from '../services/ingestion';

interface CliOptions {
  write: boolean;
  placeId: string | null;
  limit: number | null;
  delayMs: number;
}

function parseArgs(argv: string[]): CliOptions {
  const valueOf = (flag: string): string | null => {
    const index = argv.indexOf(flag);
    return index >= 0 && argv[index + 1] ? argv[index + 1]! : null;
  };

  const limit = valueOf('--limit');
  const delay = valueOf('--delay');

  return {
    write: argv.includes('--write'),
    placeId: valueOf('--place'),
    limit: limit ? Number.parseInt(limit, 10) : null,
    delayMs: delay ? Number.parseInt(delay, 10) : 250,
  };
}

function summarise(report: IngestionReport): string {
  const lines = [
    `checked ${report.sourcesConsidered} citations across ${report.placesConsidered} records`,
    `  resolved : ${report.totals.resolved}`,
    `  missing  : ${report.totals.missing}`,
    `  skipped  : ${report.totals.skipped} (not a Wikimedia endpoint)`,
    `  errors   : ${report.totals.error} (could not be checked)`,
    `coordinate warnings : ${report.coordinateWarnings}`,
    `duplicate candidates: ${report.duplicateCandidates.length} (flagged for review, never merged)`,
  ];

  const missing = report.results.filter((result) => result.status === 'missing');
  if (missing.length > 0) {
    lines.push('', 'Citations that no longer resolve:');
    for (const result of missing) lines.push(`  ${result.placeId}: ${result.url}`);
  }

  const drifted = report.results.filter((result) => result.coordinateDriftKm !== undefined);
  if (drifted.length > 0) {
    lines.push('', 'Records whose article disagrees on location:');
    for (const result of drifted) {
      lines.push(`  ${result.placeId}: ${result.coordinateDriftKm} km from the article`);
    }
  }

  const errored = report.results.filter((result) => result.status === 'error');
  if (errored.length > 0) {
    lines.push('', 'Could not be checked (left as they were):');
    for (const result of errored) lines.push(`  ${result.placeId}: ${result.url} — ${result.reason}`);
  }

  return lines.join('\n');
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const places = loadPlaces();

  const selected = options.placeId
    ? places.filter((place) => place.id === options.placeId)
    : places;
  const limited = options.limit ? selected.slice(0, options.limit) : selected;

  if (limited.length === 0) {
    console.error(`No records matched${options.placeId ? ` --place ${options.placeId}` : ''}.`);
    process.exitCode = 1;
    return;
  }

  console.log(
    `${options.write ? 'Refreshing' : 'Checking (dry run)'} ${limited.length} of ${places.length} records ` +
      `with a ${options.delayMs}ms delay between requests.`,
  );

  const { report, places: updated } = await runIngestion(limited, {
    write: options.write,
    delayMs: options.delayMs,
  });

  console.log('', summarise(report), '');

  if (options.write) {
    // Only the touched records are replaced, so --place and --limit do not discard
    // the rest of the dataset.
    const file = path.join(repoRoot(), 'data', 'places.json');
    const raw = JSON.parse(fs.readFileSync(file, 'utf8')) as { places: Array<{ id: string }> };
    const byId = new Map(updated.map((place) => [place.id, place]));
    raw.places = raw.places.map((place) => byId.get(place.id) ?? place);
    fs.writeFileSync(file, `${JSON.stringify(raw, null, 2)}\n`, 'utf8');
    console.log(`Wrote ${updated.length} records to ${path.relative(repoRoot(), file)}.`);
  } else {
    console.log('Dry run — pass --write to record these verdicts.');
  }

  // A partial run must not look like a clean one to CI or a cron job.
  if (report.incomplete) {
    console.error(`\n${report.totals.error} citation(s) could not be checked. The run was partial.`);
    process.exitCode = 1;
  }
}

main().catch((error: unknown) => {
  console.error('Ingestion failed:', error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
