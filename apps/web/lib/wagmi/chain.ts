import { arbitrum, arbitrumSepolia } from 'wagmi/chains';
import { getChainId } from '@/lib/env';

/** The chain both the client wallet config and the server routes run against.
 * Kept out of `config.ts` because that module builds RainbowKit's client-only
 * config at import time, which server routes cannot evaluate. */
const baseChain = getChainId() === 42161 ? arbitrum : arbitrumSepolia;

/** Optional RPC override. Must be http(s): the wagmi transport is `http()`. Unset → the chain's
 * stock public endpoint, which rate-limits under the QA walkthrough's polling. */
const rpcOverride = process.env.NEXT_PUBLIC_RPC_URL?.trim();

export const activeChain = rpcOverride
  ? { ...baseChain, rpcUrls: { ...baseChain.rpcUrls, default: { http: [rpcOverride] } } }
  : baseChain;
