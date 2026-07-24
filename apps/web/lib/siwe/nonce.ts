import { createHmac, timingSafeEqual } from 'crypto';
import { generateSiweNonce } from 'viem/siwe';

export const NONCE_COOKIE = 'siwe-nonce';

/** Generates a fresh SIWE nonce (delegates to viem's ERC-4361-compliant generator). */
export function generateNonce(): string {
  return generateSiweNonce();
}

function getSecret(): string {
  const secret = process.env.SIWE_COOKIE_SECRET;
  if (!secret) {
    // Fail closed: never issue/accept a nonce cookie without a configured signing secret.
    throw new Error('SIWE_COOKIE_SECRET is not configured.');
  }
  return secret;
}

function hmac(nonce: string): string {
  return createHmac('sha256', getSecret()).update(nonce).digest('hex');
}

/** Signs a nonce for storage in the httpOnly cookie, format `nonce.hmac`. */
export function signNonce(nonce: string): string {
  return `${nonce}.${hmac(nonce)}`;
}

/**
 * Verifies a signed cookie value and returns the raw nonce, or null if the
 * signature is missing/tampered (constant-time compare, T-14-07-01).
 */
export function verifyNonce(signed: string): string | null {
  const dotIndex = signed.lastIndexOf('.');
  if (dotIndex <= 0) return null;

  const nonce = signed.slice(0, dotIndex);
  const mac = signed.slice(dotIndex + 1);
  const expected = hmac(nonce);

  const macBuf = Buffer.from(mac, 'hex');
  const expectedBuf = Buffer.from(expected, 'hex');
  if (macBuf.length !== expectedBuf.length || macBuf.length === 0) return null;
  if (!timingSafeEqual(macBuf, expectedBuf)) return null;

  return nonce;
}
