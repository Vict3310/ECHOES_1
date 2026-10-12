import fs from 'node:fs';
import path from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app';
import { resetRepository } from '../src/repo';
import { sniffImage, uploadsDirectory } from '../src/services/uploads';

/** A real 1×1 PNG — small enough to stay under the test size limit. */
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==',
  'base64',
);

function textFile(): Buffer {
  return Buffer.from('#!/bin/sh\necho "definitely not an image"\n', 'utf8');
}

/** Deliberately lies about what it is: PNG bytes, JPEG name and declared type. */
function pngNamedJpeg(): Buffer {
  return PNG;
}

const app = createApp();

async function organiserToken(): Promise<string> {
  const response = await request(app)
    .post('/api/auth/register')
    .send({ email: 'guide@example.com', name: 'Guide', password: 'guide-password-1', role: 'organizer' })
    .expect(201);
  return response.body.data.token as string;
}

function storedFiles(): string[] {
  try {
    return fs.readdirSync(uploadsDirectory());
  } catch {
    return [];
  }
}

beforeEach(() => {
  resetRepository();
  fs.rmSync(uploadsDirectory(), { recursive: true, force: true });
});

describe('image sniffing', () => {
  it('identifies the formats it accepts from their own bytes', () => {
    expect(sniffImage(PNG)).toEqual({ mime: 'image/png', extension: 'png' });
    expect(sniffImage(Buffer.from([0xff, 0xd8, 0xff, 0xe0]))).toEqual({
      mime: 'image/jpeg',
      extension: 'jpg',
    });
    expect(sniffImage(Buffer.from('GIF89a', 'utf8'))).toEqual({ mime: 'image/gif', extension: 'gif' });
    expect(
      sniffImage(Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBP')])),
    ).toEqual({ mime: 'image/webp', extension: 'webp' });
  });

  it('refuses anything that is not an image', () => {
    expect(sniffImage(textFile())).toBeNull();
    expect(sniffImage(Buffer.alloc(0))).toBeNull();
  });
});

describe('image upload endpoint', () => {
  it('requires authentication', async () => {
    await request(app).post('/api/uploads').attach('image', PNG, 'photo.png').expect(401);
    expect(storedFiles()).toHaveLength(0);
  });

  it('stores an image and returns a path this server serves', async () => {
    const token = await organiserToken();
    const response = await request(app)
      .post('/api/uploads')
      .set('authorization', `Bearer ${token}`)
      .attach('image', PNG, 'photo.png')
      .expect(201);

    const { url, mime, filename } = response.body.data as {
      url: string;
      mime: string;
      filename: string;
    };

    expect(mime).toBe('image/png');
    expect(url).toMatch(/^\/uploads\/[0-9a-f-]+\.png$/);
    expect(fs.readFileSync(path.join(uploadsDirectory(), filename))).toEqual(PNG);

    // And it is actually reachable back over HTTP.
    const fetched = await request(app).get(url).expect(200);
    expect(fetched.headers['content-type']).toMatch(/image\/png/);
  });

  it('trusts the bytes, not the filename the client sent', async () => {
    const token = await organiserToken();
    const response = await request(app)
      .post('/api/uploads')
      // PNG bytes, claimed as a JPEG: it must still be stored and served as a PNG.
      .set('authorization', `Bearer ${token}`)
      .attach('image', pngNamedJpeg(), { filename: 'avatar.jpg', contentType: 'image/jpeg' })
      .expect(201);

    expect(response.body.data.mime).toBe('image/png');
    expect(response.body.data.url).toMatch(/\.png$/);
  });

  it('accepts a real image whose filename and declared type lie', async () => {
    const token = await organiserToken();
    const response = await request(app)
      .post('/api/uploads')
      .set('authorization', `Bearer ${token}`)
      // PNG bytes, named as text and declared as text: the bytes are what count.
      .attach('image', PNG, { filename: 'photo.txt', contentType: 'text/plain' })
      .expect(201);

    expect(response.body.data.mime).toBe('image/png');
    expect(response.body.data.url).toMatch(/\.png$/);
  });

  it('rejects a non-image and writes nothing to disk', async () => {
    const token = await organiserToken();
    const response = await request(app)
      .post('/api/uploads')
      .set('authorization', `Bearer ${token}`)
      .attach('image', textFile(), { filename: 'payload.png', contentType: 'image/png' })
      .expect(400);

    expect(response.body.error.message).toMatch(/not a JPEG, PNG, GIF or WebP/i);
    expect(storedFiles()).toHaveLength(0);
  });

  it('rejects an oversized image with a readable message', async () => {
    const token = await organiserToken();
    const response = await request(app)
      .post('/api/uploads')
      .set('authorization', `Bearer ${token}`)
      // Padded past the limit configured for tests.
      .attach('image', Buffer.concat([PNG, Buffer.alloc(8 * 1024)]), 'big.png')
      .expect(400);

    expect(response.body.error.message).toMatch(/smaller than/i);
    expect(storedFiles()).toHaveLength(0);
  });

  it('rejects a request with no file attached', async () => {
    const token = await organiserToken();
    const response = await request(app)
      .post('/api/uploads')
      .set('authorization', `Bearer ${token}`)
      .expect(400);

    expect(response.body.error.message).toMatch(/attach an image/i);
  });
});

describe('guide profiles and uploaded photos', () => {
  it('accepts a photo path issued by the upload endpoint and serves it back', async () => {
    const token = await organiserToken();
    const upload = await request(app)
      .post('/api/uploads')
      .set('authorization', `Bearer ${token}`)
      .attach('image', PNG, 'photo.png')
      .expect(201);

    const created = await request(app)
      .post('/api/guides')
      .set('authorization', `Bearer ${token}`)
      .send({
        name: 'Ada Okafor',
        role: 'Heritage storyteller',
        city: 'Lagos Island',
        specialties: ['Walks'],
        bio: 'Short, deeply local heritage walks across the old city core and the marina.',
        avatarUrl: upload.body.data.url,
      })
      .expect(201);

    expect(created.body.data.guide.avatarUrl).toBe(upload.body.data.url);
  });

  it('refuses a photo URL this server did not issue', async () => {
    const token = await organiserToken();
    await request(app)
      .post('/api/guides')
      .set('authorization', `Bearer ${token}`)
      .send({
        name: 'Ada Okafor',
        role: 'Heritage storyteller',
        city: 'Lagos Island',
        specialties: ['Walks'],
        bio: 'Short, deeply local heritage walks across the old city core and the marina.',
        avatarUrl: 'https://example.org/tracker.png',
      })
      .expect(400);

    await request(app)
      .post('/api/guides')
      .set('authorization', `Bearer ${token}`)
      .send({
        name: 'Ada Okafor',
        role: 'Heritage storyteller',
        city: 'Lagos Island',
        specialties: ['Walks'],
        bio: 'Short, deeply local heritage walks across the old city core and the marina.',
        avatarUrl: '/uploads/../../etc/passwd',
      })
      .expect(400);
  });
});
