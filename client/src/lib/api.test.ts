import { beforeEach, describe, expect, it, vi } from 'vitest';
import { api, ApiClientError } from './api';

interface Call {
  url: string;
  init: RequestInit;
}

const calls: Call[] = [];

function stubFetch(status: number, body: unknown): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init: RequestInit) => {
      calls.push({ url: String(url), init });
      return {
        ok: status >= 200 && status < 300,
        status,
        text: async () => JSON.stringify(body),
      } as unknown as Response;
    }),
  );
}

beforeEach(() => {
  calls.length = 0;
  vi.unstubAllGlobals();
});

describe('uploading an image', () => {
  it('posts multipart form data without a JSON content type', async () => {
    stubFetch(201, { data: { url: '/uploads/abc.png', filename: 'abc.png', mime: 'image/png', bytes: 12 } });

    const file = new File([new Uint8Array([1, 2, 3])], 'photo.jpg', { type: 'image/jpeg' });
    const result = await api.uploads.image(file, 'token-123');

    expect(result.url).toBe('/uploads/abc.png');
    expect(calls).toHaveLength(1);

    const { url, init } = calls[0]!;
    expect(url).toContain('/api/uploads');
    expect(init.method).toBe('POST');
    expect(init.body).toBeInstanceOf(FormData);

    // The browser must set this, because the value carries the multipart boundary.
    const headers = (init.headers ?? {}) as Record<string, string>;
    expect(headers['content-type']).toBeUndefined();
    expect(headers.authorization).toBe('Bearer token-123');

    // The file itself is what was attached.
    const attached = (init.body as FormData).get('image') as File;
    expect(attached.name).toBe('photo.jpg');
  });

  it('surfaces the server message when an upload is refused', async () => {
    stubFetch(400, { error: { message: 'That file is not a JPEG, PNG, GIF or WebP image.', code: 'bad_request' } });

    const file = new File([new Uint8Array([1])], 'script.sh', { type: 'image/png' });
    await expect(api.uploads.image(file, 'token-123')).rejects.toThrow(/not a JPEG, PNG, GIF or WebP/i);
  });

  it('reports an unreachable API as a network error rather than a silent failure', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('ECONNREFUSED');
      }),
    );

    const file = new File([new Uint8Array([1])], 'photo.png', { type: 'image/png' });
    await expect(api.uploads.image(file, 'token-123')).rejects.toBeInstanceOf(ApiClientError);
  });
});
