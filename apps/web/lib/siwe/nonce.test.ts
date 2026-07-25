import { beforeAll, describe, expect, it } from 'vitest';
import { generateNonce, signNonce, verifyNonce } from './nonce';

beforeAll(() => {
  process.env.SIWE_COOKIE_SECRET = 'test-secret-do-not-use-in-prod';
});

describe('nonce', () => {
  it('generates a fresh, non-empty nonce each call', () => {
    const a = generateNonce();
    const b = generateNonce();
    expect(a).not.toBe(b);
    expect(a.length).toBeGreaterThan(0);
  });

  it('signs and verifies a nonce round-trip', () => {
    const nonce = generateNonce();
    expect(verifyNonce(signNonce(nonce))).toBe(nonce);
  });

  it('rejects a tampered signature', () => {
    const signed = signNonce('sometestnonce');
    const tampered = signed.replace(/.$/, (c) => (c === '0' ? '1' : '0'));
    expect(verifyNonce(tampered)).toBeNull();
  });

  it('rejects a malformed value with no separator', () => {
    expect(verifyNonce('not-a-signed-nonce')).toBeNull();
  });
});
