import { arbitrum, arbitrumSepolia } from 'wagmi/chains';
import { getChainId } from '@/lib/env';

/** The chain both the client wallet config and the server routes run against.
 * Kept out of `config.ts` because that module builds RainbowKit's client-only
 * config at import time, which server routes cannot evaluate. */
export const activeChain = getChainId() === 42161 ? arbitrum : arbitrumSepolia;
