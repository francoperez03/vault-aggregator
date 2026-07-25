import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { createPublicClient, http } from 'viem';
import { parseSiweMessage, verifySiweMessage } from 'viem/siwe';
import { activeChain } from '@/lib/wagmi/chain';
import { verifyNonce, NONCE_COOKIE } from '@/lib/siwe/nonce';

/** Minimal shape of `next/headers`' cookie store this route needs — kept as an
 * injectable seam so verifyAndConsume is unit-testable without a request context. */
export interface CookieJar {
  get(name: string): { value: string } | undefined;
  delete(name: string): void;
}

export interface SiweVerifier {
  verifySiweMessage(params: { message: string; signature: `0x${string}` }): Promise<boolean>;
}

function defaultVerifier(): SiweVerifier {
  const client = createPublicClient({ chain: activeChain, transport: http() });
  return {
    verifySiweMessage: (params) => verifySiweMessage(client, params),
  };
}

export interface VerifyResult {
  status: number;
  json: { verified: boolean; wallet?: `0x${string}` };
}

/**
 * Verifies a SIWE authentication attempt against the single-use nonce cookie.
 * ALWAYS deletes the nonce cookie before returning — this is what enforces
 * single-use (T-14-07-01): a replayed nonce finds no cookie on the second call.
 */
export async function verifyAndConsume(
  jar: CookieJar,
  body: unknown,
  verifier: SiweVerifier = defaultVerifier(),
): Promise<VerifyResult> {
  try {
    const cookie = jar.get(NONCE_COOKIE);
    if (!cookie) return { status: 401, json: { verified: false } };

    const expectedNonce = verifyNonce(cookie.value);
    if (!expectedNonce) return { status: 401, json: { verified: false } };

    if (
      typeof body !== 'object' ||
      body === null ||
      typeof (body as { message?: unknown }).message !== 'string' ||
      typeof (body as { signature?: unknown }).signature !== 'string'
    ) {
      return { status: 400, json: { verified: false } };
    }
    const { message, signature } = body as { message: string; signature: `0x${string}` };

    const parsed = parseSiweMessage(message);
    if (!parsed.nonce || parsed.nonce !== expectedNonce) {
      return { status: 401, json: { verified: false } };
    }

    const isVerified = await verifier.verifySiweMessage({ message, signature });
    if (!isVerified || !parsed.address) {
      return { status: 401, json: { verified: false } };
    }

    return { status: 200, json: { verified: true, wallet: parsed.address } };
  } catch {
    return { status: 401, json: { verified: false } };
  } finally {
    jar.delete(NONCE_COOKIE);
  }
}

export async function POST(request: Request) {
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ verified: false }, { status: 400 });
  }

  const store = await cookies();
  const result = await verifyAndConsume(store, body);
  return NextResponse.json(result.json, { status: result.status });
}
