/**
 * Image uploads.
 *
 * Guides need to attach a photograph to an application, and moderation needs to
 * know what it is looking at. Two rules drive the implementation:
 *
 *   - The client's filename is never trusted. The extension is derived from the
 *     file's own leading bytes, and anything that is not a recognised image is
 *     rejected — so a script cannot be stored under a name the server later hands
 *     back with an image content type.
 *   - Storage is local disk, which is right for development and single-instance
 *     hosts. A multi-instance deployment needs object storage instead; see the
 *     note in the README rather than assuming this scales.
 */
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import multer from 'multer';
import { env } from '../../env';
import { ApiError } from '../../lib/errors';

export interface ImageSignature {
  mime: string;
  extension: string;
}

/**
 * Reads the file's own bytes. A PNG that the client called `.jpg` is stored as a
 * PNG, and a file that is neither is refused outright.
 */
export function sniffImage(bytes: Uint8Array): ImageSignature | null {
  const startsWith = (...signature: number[]): boolean =>
    signature.every((byte, index) => bytes[index] === byte);

  if (startsWith(0xff, 0xd8, 0xff)) return { mime: 'image/jpeg', extension: 'jpg' };
  if (startsWith(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)) {
    return { mime: 'image/png', extension: 'png' };
  }
  if (startsWith(0x47, 0x49, 0x46, 0x38)) return { mime: 'image/gif', extension: 'gif' };

  // RIFF....WEBP
  const isRiff = startsWith(0x52, 0x49, 0x46, 0x46);
  const isWebp =
    bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50;
  if (isRiff && isWebp) return { mime: 'image/webp', extension: 'webp' };

  return null;
}

export function uploadsDirectory(): string {
  return path.isAbsolute(env.uploads.dir) ? env.uploads.dir : path.join(process.cwd(), env.uploads.dir);
}

/** Public URL for a stored file, under the path the app serves it from. */
export function publicUrlFor(filename: string): string {
  return `${env.uploads.publicPath.replace(/\/$/, '')}/${filename}`;
}

/**
 * Memory storage is used deliberately: the bytes are sniffed before anything
 * touches the disk, so a rejected file never lands in the uploads directory.
 *
 * There is no filter on the *declared* content type. A valid PNG that a client
 * called `photo.txt` and declared as `text/plain` is still a PNG, and rejecting it
 * would make the filename authoritative — the opposite of what this service
 * promises. The size limit bounds what a rejection can cost.
 */
export const uploadSingleImage = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: env.uploads.maxBytes,
    files: 1,
  },
});

export interface StoredUpload {
  url: string;
  filename: string;
  mime: string;
  bytes: number;
}

/**
 * Writes a sniffed image to disk and returns its public URL. Rejects anything whose
 * bytes are not an image, whatever the request claimed.
 */
export async function storeImage(buffer: Buffer): Promise<StoredUpload> {
  const signature = sniffImage(buffer);
  if (!signature) {
    throw ApiError.badRequest('That file is not a JPEG, PNG, GIF or WebP image.');
  }

  const directory = uploadsDirectory();
  await fs.promises.mkdir(directory, { recursive: true });

  // Random name: never derived from client input, so nothing can traverse paths or
  // overwrite another upload.
  const filename = `${randomUUID()}.${signature.extension}`;
  await fs.promises.writeFile(path.join(directory, filename), buffer);

  return {
    url: publicUrlFor(filename),
    filename,
    mime: signature.mime,
    bytes: buffer.byteLength,
  };
}
