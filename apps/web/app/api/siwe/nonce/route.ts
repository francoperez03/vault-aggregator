import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { generateNonce, signNonce, NONCE_COOKIE } from '@/lib/siwe/nonce';

export { NONCE_COOKIE };

export async function POST() {
  let nonce: string;
  let signed: string;
  try {
    nonce = generateNonce();
    signed = signNonce(nonce);
  } catch {
    return NextResponse.json({ error: 'SIWE is not configured.' }, { status: 503 });
  }

  const store = await cookies();
  store.set(NONCE_COOKIE, signed, {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    maxAge: 300, // 5 minutes
    path: '/',
  });

  return NextResponse.json({ nonce });
}
