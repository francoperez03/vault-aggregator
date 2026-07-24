'use client';

import { useCallback, useEffect, useSyncExternalStore } from 'react';
import { getLemonBridge, isLemonWebView } from '@/lib/lemon/bridge';

interface SiweState {
  wallet: `0x${string}` | null;
  isAuthenticating: boolean;
  error: string | null;
}

interface UseSiweResult extends SiweState {
  authenticate: () => Promise<void>;
}

// Module-level store shared by every useSiwe() consumer: however many components
// subscribe, authenticate() runs once per app entry (D-03/D-14 — no localStorage/session,
// a page reload re-authenticates from scratch).
const initialState: SiweState = { wallet: null, isAuthenticating: false, error: null };
let state: SiweState = initialState;
let started = false;
const listeners = new Set<() => void>();

function setState(next: SiweState) {
  state = next;
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

const getSnapshot = () => state;
const getServerSnapshot = () => initialState;

async function runAuthenticate(): Promise<void> {
  if (!isLemonWebView()) return;

  setState({ ...state, isAuthenticating: true, error: null });
  try {
    const nonceResponse = await fetch('/api/siwe/nonce', { method: 'POST' });
    if (!nonceResponse.ok) throw new Error('Failed to fetch SIWE nonce.');
    const { nonce } = (await nonceResponse.json()) as { nonce: string };

    const { message, signature } = await getLemonBridge().authenticate(nonce);

    const verifyResponse = await fetch('/api/siwe/verify', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message, signature }),
    });
    const result = (await verifyResponse.json()) as { verified: boolean; wallet?: `0x${string}` };

    if (!verifyResponse.ok || !result.verified || !result.wallet) {
      throw new Error('SIWE verification failed.');
    }

    setState({ wallet: result.wallet, isAuthenticating: false, error: null });
  } catch {
    setState({ wallet: null, isAuthenticating: false, error: 'Lemon sign-in failed. Please try again.' });
  }
}

/**
 * SIWE auth for the Lemon WebView runtime (D-03): authenticate() re-runs on
 * every app entry, the address lives only in the shared module store (no
 * localStorage/session — every entry re-authenticates from scratch). No-op in
 * standalone mode, where the wallet comes from RainbowKit/wagmi instead.
 */
export function useSiwe(): UseSiweResult {
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  const authenticate = useCallback(() => runAuthenticate(), []);

  useEffect(() => {
    if (!started && isLemonWebView()) {
      started = true;
      void runAuthenticate();
    }
  }, []);

  return { ...snapshot, authenticate };
}
