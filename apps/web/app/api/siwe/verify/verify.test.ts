import { beforeAll, describe, expect, it } from 'vitest';
import { createSiweMessage } from 'viem/siwe';
import { signNonce } from '@/lib/siwe/nonce';
import { verifyAndConsume, type CookieJar, type SiweVerifier } from './route';

const WALLET = '0x000000000000000000000000000000000000000A' as const;

class FakeCookieJar implements CookieJar {
  private store = new Map<string, string>();

  set(value: string) {
    this.store.set('siwe-nonce', value);
  }

  get(name: string) {
    const value = this.store.get(name);
    return value === undefined ? undefined : { value };
  }

  delete(name: string) {
    this.store.delete(name);
  }
}

const acceptAll: SiweVerifier = { verifySiweMessage: async () => true };

function buildMessage(nonce: string): string {
  return createSiweMessage({
    address: WALLET,
    chainId: 421614,
    domain: 'localhost',
    nonce,
    uri: 'https://localhost',
    version: '1',
  });
}

beforeAll(() => {
  process.env.SIWE_COOKIE_SECRET = 'test-secret-do-not-use-in-prod';
});

describe('verifyAndConsume', () => {
  it('verifies a valid message whose nonce matches the cookie, and deletes the cookie', async () => {
    const jar = new FakeCookieJar();
    jar.set(signNonce('nonceone1'));

    const result = await verifyAndConsume(jar, { message: buildMessage('nonceone1'), signature: '0xaa' }, acceptAll);

    expect(result.status).toBe(200);
    expect(result.json).toEqual({ verified: true, wallet: WALLET });
    expect(jar.get('siwe-nonce')).toBeUndefined();
  });

  it('rejects a replay of an already-consumed nonce (single-use, T-14-07-01)', async () => {
    const jar = new FakeCookieJar();
    jar.set(signNonce('noncetwo2'));
    const body = { message: buildMessage('noncetwo2'), signature: '0xaa' };

    const first = await verifyAndConsume(jar, body, acceptAll);
    expect(first.status).toBe(200);

    const second = await verifyAndConsume(jar, body, acceptAll);
    expect(second.status).toBe(401);
    expect(second.json).toEqual({ verified: false });
  });

  it('rejects when the message nonce does not match the cookie nonce', async () => {
    const jar = new FakeCookieJar();
    jar.set(signNonce('noncecookie1'));

    const result = await verifyAndConsume(
      jar,
      { message: buildMessage('noncediff123'), signature: '0xaa' },
      acceptAll,
    );

    expect(result.status).toBe(401);
    expect(result.json).toEqual({ verified: false });
    expect(jar.get('siwe-nonce')).toBeUndefined();
  });

  it('rejects when there is no nonce cookie at all', async () => {
    const jar = new FakeCookieJar();
    const result = await verifyAndConsume(jar, { message: buildMessage('noncexxxx1'), signature: '0xaa' }, acceptAll);
    expect(result.status).toBe(401);
  });

  it('rejects a tampered signed cookie value', async () => {
    const jar = new FakeCookieJar();
    const tampered = signNonce('noncetamper1').replace(/.$/, (c) => (c === '0' ? '1' : '0'));
    jar.set(tampered);

    const result = await verifyAndConsume(
      jar,
      { message: buildMessage('noncetamper1'), signature: '0xaa' },
      acceptAll,
    );

    expect(result.status).toBe(401);
  });

  it('rejects when the underlying signature verification fails', async () => {
    const jar = new FakeCookieJar();
    jar.set(signNonce('noncebadsig1'));
    const rejectAll: SiweVerifier = { verifySiweMessage: async () => false };

    const result = await verifyAndConsume(
      jar,
      { message: buildMessage('noncebadsig1'), signature: '0xaa' },
      rejectAll,
    );

    expect(result.status).toBe(401);
  });
});
