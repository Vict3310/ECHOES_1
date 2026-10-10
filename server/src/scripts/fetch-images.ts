/**
 * Image + source-provenance enrichment.
 *
 * For every cultural place whose record cites an English Wikipedia article, this
 * script:
 *   1. resolves the article (following redirects) and records whether it exists;
 *   2. resolves the article's lead image;
 *   3. fetches that file's licence metadata from Wikimedia Commons;
 *   4. accepts the image ONLY when the licence is a recognised free licence;
 *   5. downloads an appropriately sized copy into client/public/places/ and
 *      records full attribution in data/places.json.
 *
 * It refuses to invent anything: an article that does not exist, a page with no
 * lead image, and a non-free or unverifiable licence are all reported as such and
 * left without an image, so the interface falls back to its designed placeholder.
 *
 * Usage:
 *   npx tsx src/scripts/fetch-images.ts --dry-run   # report only, writes nothing
 *   npx tsx src/scripts/fetch-images.ts             # download and write
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { env } from '../env';
import { repoRoot } from '../data/dataset';

const DRY_RUN = process.argv.includes('--dry-run');
/**
 * Target width for the copy ECHOES serves. Wikimedia reports the width you ask
 * for but serves the next standard size bucket up (or the original when it is
 * narrower), so the real dimensions are measured from the bytes we receive
 * rather than trusted from the API response.
 */
const THUMB_WIDTH = 1280;
const JPEG_QUALITY = '5'; // ffmpeg -q:v scale, roughly 80-85% quality
const USER_AGENT = env.culturalData.userAgent;

interface WikimediaPage {
  title?: string;
  missing?: boolean;
  pageimage?: string;
  thumbnail?: { source?: string; width?: number; height?: number };
}

interface ExtMetadata {
  LicenseShortName?: { value?: string };
  LicenseUrl?: { value?: string };
  Artist?: { value?: string };
  Credit?: { value?: string };
  AttributionRequired?: { value?: string };
  UsageTerms?: { value?: string };
}

interface PlaceImage {
  file: string;
  localPath: string;
  width: number;
  height: number;
  /** True when ECHOES resized/re-encoded the file, which the credit states. */
  modified: boolean;
  mime: string;
  license: string;
  licenseUrl: string | null;
  artist: string | null;
  credit: string | null;
  attributionRequired: boolean;
  filePageUrl: string;
  articleUrl: string;
  retrievedAt: string;
}

/**
 * Licences we are willing to redistribute. GFDL is deliberately NOT accepted:
 * it is a free licence, but redistribution requires shipping the full licence
 * text with the asset, which a credit line cannot satisfy. Anything we are not
 * certain about is reported and left without an image.
 */
const FREE_LICENSE = /^(cc0|cc[- ]?by([- ]?sa)?([- ]?\d(\.\d)?)?|public domain|pd[- ])/i;
const NON_FREE = /(non[- ]free|fair use|fair dealing|copyright|all rights reserved|gfdl)/i;

function stripHtml(value: string | undefined): string | null {
  if (!value) return null;
  const text = value
    .replace(/<[^>]*>/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&nbsp;/g, ' ')
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ')
    .trim();
  return text.length > 0 ? text : null;
}

/**
 * Reads real pixel dimensions out of a JPEG or PNG header, so the dataset can
 * never claim a size the file is not.
 */
function imageSize(buffer: Buffer): { width: number; height: number } | null {
  if (buffer.length > 24 && buffer.toString('latin1', 1, 4) === 'PNG') {
    return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
  }
  if (buffer[0] !== 0xff || buffer[1] !== 0xd8) return null;
  let offset = 2;
  while (offset < buffer.length - 9) {
    if (buffer[offset] !== 0xff) {
      offset += 1;
      continue;
    }
    const marker = buffer[offset + 1] as number;
    if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
      return { height: buffer.readUInt16BE(offset + 5), width: buffer.readUInt16BE(offset + 7) };
    }
    if (marker === 0xd8 || marker === 0xd9 || (marker >= 0xd0 && marker <= 0xd7)) {
      offset += 2;
      continue;
    }
    offset += 2 + buffer.readUInt16BE(offset + 2);
  }
  return null;
}

/**
 * Maps an image mime type to the extension the file is stored under. Returns
 * null for anything a browser cannot render directly, so an unsupported file is
 * refused rather than written with an extension that misdescribes it.
 */
function extensionFor(mime: string): string | null {
  if (mime.includes('jpeg') || mime.includes('jpg')) return 'jpg';
  if (mime.includes('png')) return 'png';
  if (mime.includes('webp')) return 'webp';
  if (mime.includes('gif')) return 'gif';
  if (mime.includes('svg')) return 'svg';
  return null;
}

let ffmpegAvailable: boolean | null = null;
function hasFfmpeg(): boolean {
  if (ffmpegAvailable !== null) return ffmpegAvailable;
  try {
    execFileSync('ffmpeg', ['-version'], { stdio: 'ignore' });
    ffmpegAvailable = true;
  } catch {
    ffmpegAvailable = false;
  }
  return ffmpegAvailable;
}

/**
 * Builds the width-limited JPEG that ECHOES actually serves. CC BY-SA and
 * public-domain licences both permit derivatives; the modification is recorded
 * in the attribution so the credit stays truthful.
 */
function makeDerivative(buffer: Buffer, tmpDir: string): Buffer | null {
  const input = path.join(tmpDir, 'in.bin');
  const output = path.join(tmpDir, 'out.jpg');
  try {
    fs.writeFileSync(input, buffer);
    execFileSync(
      'ffmpeg',
      [
        '-hide_banner',
        '-loglevel',
        'error',
        '-y',
        '-i',
        input,
        '-vf',
        `scale='min(${THUMB_WIDTH},iw)':-2`,
        '-q:v',
        JPEG_QUALITY,
        output,
      ],
      { stdio: 'ignore' },
    );
    return fs.readFileSync(output);
  } catch {
    return null;
  } finally {
    for (const file of [input, output]) {
      try {
        fs.unlinkSync(file);
      } catch {
        /* best effort */
      }
    }
  }
}

async function getJson<T>(url: string): Promise<T> {
  const response = await fetch(url, {
    headers: { 'user-agent': USER_AGENT, accept: 'application/json' },
  });
  if (!response.ok) throw new Error(`HTTP ${response.status} for ${url.slice(0, 120)}`);
  return (await response.json()) as T;
}

/** Resolve an article title, following redirects, and get its lead image. */
async function resolveArticle(wikiHost: string, title: string): Promise<WikimediaPage> {
  const params = new URLSearchParams({
    action: 'query',
    format: 'json',
    formatversion: '2',
    redirects: '1',
    prop: 'pageimages',
    piprop: 'thumbnail|name',
    pithumbsize: String(THUMB_WIDTH),
    titles: title,
  });
  const data = await getJson<{ query?: { pages?: WikimediaPage[] } }>(
    `${wikiHost}/w/api.php?${params.toString()}`,
  );
  return data.query?.pages?.[0] ?? {};
}

/** Licence + attribution metadata for a file, preferring Wikimedia Commons. */
async function resolveFileMetadata(fileName: string): Promise<{
  meta: ExtMetadata;
  filePageUrl: string;
  mime: string;
  /** Scaled copy at THUMB_WIDTH. Asking for a width is the only way to be sure
   *  we download a resized file: the pageimages "thumbnail" is the original
   *  whenever the original is narrower than the requested size. */
  thumbUrl: string | null;
  thumbWidth: number | null;
  thumbHeight: number | null;
} | null> {
  const hosts = [
    'https://commons.wikimedia.org',
    'https://en.wikipedia.org',
  ];
  for (const host of hosts) {
    const params = new URLSearchParams({
      action: 'query',
      format: 'json',
      formatversion: '2',
      prop: 'imageinfo',
      iiprop: 'extmetadata|url|size|mime',
      iiurlwidth: String(THUMB_WIDTH),
      titles: `File:${fileName}`,
    });
    try {
      const data = await getJson<{
        query?: {
          pages?: Array<{
            missing?: boolean;
            imageinfo?: Array<{
              mime?: string;
              extmetadata?: ExtMetadata;
              thumburl?: string;
              thumbwidth?: number;
              thumbheight?: number;
            }>;
          }>;
        };
      }>(`${host}/w/api.php?${params.toString()}`);
      const page = data.query?.pages?.[0];
      const info = page?.imageinfo?.[0];
      if (page?.missing || !info?.extmetadata) continue;
      return {
        meta: info.extmetadata,
        filePageUrl: `${host}/wiki/File:${encodeURIComponent(fileName)}`,
        mime: info.mime ?? 'image/jpeg',
        thumbUrl: info.thumburl?.split('?')[0] ?? null,
        thumbWidth: info.thumbwidth ?? null,
        thumbHeight: info.thumbheight ?? null,
      };
    } catch {
      continue;
    }
  }
  return null;
}

interface ReportRow {
  place: string;
  article: string;
  outcome: 'image-added' | 'article-missing' | 'no-lead-image' | 'non-free-license' | 'no-licence-metadata' | 'unsupported-format' | 'download-failed' | 'no-wikipedia-source';
  detail: string;
}

async function main(): Promise<void> {
  const root = repoRoot();
  const placesPath = path.join(root, 'data', 'places.json');
  const outDir = path.join(root, 'client', 'public', 'places');
  const wikiHost = 'https://en.wikipedia.org';

  const file = JSON.parse(fs.readFileSync(placesPath, 'utf8')) as {
    places: Array<Record<string, unknown> & { id: string; name: string; sources?: Array<Record<string, unknown>> }>;
  };

  if (!DRY_RUN) fs.mkdirSync(outDir, { recursive: true });

  const report: ReportRow[] = [];
  let added = 0;

  for (const place of file.places) {
    const sources = place.sources ?? [];
    const wikipedia = sources.find(
      (source) => typeof source.url === 'string' && source.url.includes('en.wikipedia.org/wiki/'),
    );

    // Record existence for every source, so a citation can never point at a page
    // that does not exist.
    for (const source of sources) {
      if (typeof source.url !== 'string') continue;
      const match = source.url.match(/en\.wikipedia\.org\/wiki\/(.+)$/);
      if (!match?.[1]) continue;
      const title = decodeURIComponent(match[1]).replace(/_/g, ' ');
      try {
        const article = await resolveArticle(wikiHost, title);
        source.found = !article.missing;
        if (article.missing) {
          report.push({
            place: place.name,
            article: title,
            outcome: 'article-missing',
            detail: 'cited article does not exist — citation must be corrected',
          });
        }
      } catch (error) {
        source.found = null;
        report.push({
          place: place.name,
          article: title,
          outcome: 'no-wikipedia-source',
          detail: `could not verify: ${error instanceof Error ? error.message : 'error'}`,
        });
      }
    }

    if (!wikipedia || typeof wikipedia.url !== 'string') {
      report.push({
        place: place.name,
        article: '—',
        outcome: 'no-wikipedia-source',
        detail: 'record has no Wikipedia source',
      });
      place.image = null;
      continue;
    }

    const title = decodeURIComponent(wikipedia.url.split('/wiki/')[1] ?? '').replace(/_/g, ' ');
    try {
      const article = await resolveArticle(wikiHost, title);
      if (article.missing) {
        place.image = null;
        continue;
      }
      if (!article.pageimage || !article.thumbnail?.source) {
        place.image = null;
        report.push({
          place: place.name,
          article: title,
          outcome: 'no-lead-image',
          detail: 'article has no lead image on Wikipedia',
        });
        continue;
      }

      const file_ = await resolveFileMetadata(article.pageimage);
      if (!file_) {
        place.image = null;
        report.push({
          place: place.name,
          article: title,
          outcome: 'no-licence-metadata',
          detail: `no licence metadata found for ${article.pageimage}`,
        });
        continue;
      }

      const licenseName = stripHtml(file_.meta.LicenseShortName?.value) ?? 'unknown';
      const usageTerms = stripHtml(file_.meta.UsageTerms?.value) ?? '';
      const combined = `${licenseName} ${usageTerms}`;

      if (NON_FREE.test(combined) || !FREE_LICENSE.test(licenseName)) {
        place.image = null;
        report.push({
          place: place.name,
          article: title,
          outcome: 'non-free-license',
          detail: `rejected licence "${licenseName}" — not redistributable`,
        });
        continue;
      }

      const sourceExt = extensionFor(file_.mime);
      if (!sourceExt) {
        place.image = null;
        report.push({
          place: place.name,
          article: title,
          outcome: 'unsupported-format',
          detail: `unsupported image format "${file_.mime}" for ${article.pageimage}`,
        });
        continue;
      }

      const source = file_.thumbUrl ?? article.thumbnail.source.split('?')[0]!;
      let width = file_.thumbWidth ?? article.thumbnail.width ?? 0;
      let height = file_.thumbHeight ?? article.thumbnail.height ?? 0;
      // The stored extension and mime always describe the bytes on disk.
      let storedExt = sourceExt;
      let storedMime = file_.mime;
      let modified = false;

      if (!DRY_RUN) {
        const response = await fetch(source, { headers: { 'user-agent': USER_AGENT } });
        if (!response.ok) {
          throw new Error(`download failed HTTP ${response.status}`);
        }
        let buffer: Buffer = Buffer.from(await response.arrayBuffer());

        // Trust the bytes, not the API: Wikimedia serves the next size bucket up.
        const measured = imageSize(buffer);
        if (measured) {
          width = measured.width;
          height = measured.height;
        }

        // Re-encode when it meaningfully shrinks the payload: files kept above the
        // target width, and PNG photographs, which are many times larger than JPEG
        // for the same picture. Without ffmpeg the download is used unchanged.
        if (hasFfmpeg() && (width > THUMB_WIDTH || file_.mime.includes('png'))) {
          const derivative = makeDerivative(buffer, os.tmpdir());
          const after = derivative ? imageSize(derivative) : null;
          if (derivative && after && after.width > 0) {
            buffer = derivative;
            width = after.width;
            height = after.height;
            storedExt = 'jpg';
            storedMime = 'image/jpeg';
            modified = true;
          }
        }

        // Keep the directory idempotent: drop any earlier copy of this place.
        for (const stale of fs.readdirSync(outDir).filter((name) => name.startsWith(`${place.id}.`))) {
          if (stale !== `${place.id}.${storedExt}`) fs.unlinkSync(path.join(outDir, stale));
        }
        fs.writeFileSync(path.join(outDir, `${place.id}.${storedExt}`), buffer);
      }

      const outFile = `${place.id}.${storedExt}`;

      const image: PlaceImage = {
        file: article.pageimage,
        localPath: `/places/${outFile}`,
        width,
        height,
        modified,
        mime: storedMime,
        license: licenseName,
        licenseUrl: stripHtml(file_.meta.LicenseUrl?.value),
        artist: stripHtml(file_.meta.Artist?.value),
        credit: stripHtml(file_.meta.Credit?.value),
        attributionRequired: (stripHtml(file_.meta.AttributionRequired?.value) ?? 'true') === 'true',
        filePageUrl: file_.filePageUrl,
        // encodeURI (not encodeURIComponent) keeps commas and parentheses valid
        // in article titles, e.g. "Freedom Park, Lagos".
        articleUrl: `https://en.wikipedia.org/wiki/${encodeURI(title.replace(/ /g, '_'))}`,
        retrievedAt: new Date().toISOString().slice(0, 10),
      };
      place.image = image;
      added += 1;
      report.push({
        place: place.name,
        article: title,
        outcome: 'image-added',
        detail: `${image.license} · ${image.artist ?? 'author unstated'} · ${outFile} · ${width}x${height}${modified ? ' (resized)' : ''}`,
      });
    } catch (error) {
      place.image = null;
      report.push({
        place: place.name,
        article: title,
        outcome: 'download-failed',
        detail: error instanceof Error ? error.message : 'unknown error',
      });
    }
  }

  if (!DRY_RUN) {
    fs.writeFileSync(placesPath, `${JSON.stringify(file, null, 2)}\n`);
  }

  const width = Math.max(...report.map((row) => row.place.length), 8);
  console.log(`\n${DRY_RUN ? 'DRY RUN — nothing written' : 'Enrichment complete'}\n`);
  for (const row of report) {
    console.log(
      `${row.place.padEnd(width)}  ${row.outcome.padEnd(20)}  ${row.article}\n${' '.repeat(width)}  ${row.detail}`,
    );
  }
  const counts = report.reduce<Record<string, number>>((acc, row) => {
    acc[row.outcome] = (acc[row.outcome] ?? 0) + 1;
    return acc;
  }, {});
  console.log(`\nimages added: ${added}/${file.places.length}`);
  console.log('outcomes:', counts);
}

main().catch((error) => {
  console.error('Enrichment failed:', error);
  process.exitCode = 1;
});
