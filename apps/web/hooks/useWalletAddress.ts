'use client';

import { useAccount } from 'wagmi';
import { isLemonWebView } from '@/lib/lemon/bridge';
import { useSiwe } from '@/hooks/useSiwe';

/** Active wallet in either runtime: the SIWE-signed wallet inside the Lemon WebView (wagmi never
 * connects there — Lemon injects no EIP-1193 provider), the wagmi account otherwise. Subscribing
 * also kicks off the Lemon auto-auth on pages entered directly (useSiwe runs once per app entry).
 * Ported from CoinFlip's hook of the same name. */
export function useWalletAddress(): `0x${string}` | undefined {
  const { address } = useAccount();
  const { wallet } = useSiwe();
  return isLemonWebView() ? (wallet ?? undefined) : address;
}
