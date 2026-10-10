import crypto from 'node:crypto';

export function uuid(): string {
  return crypto.randomUUID();
}

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/** Short, unambiguous, human-readable reference (no 0/O/1/I confusion). */
export function reference(prefix: string, length = 8): string {
  let out = '';
  const bytes = crypto.randomBytes(length);
  for (let i = 0; i < length; i += 1) {
    out += ALPHABET[bytes[i]! % ALPHABET.length];
  }
  return `${prefix}-${out}`;
}

export function bookingReference(): string {
  return reference('ECH-BK');
}

export function storyReference(): string {
  return reference('ECH-ST');
}

export function paymentReference(): string {
  return reference('ECH-PAY', 10);
}
