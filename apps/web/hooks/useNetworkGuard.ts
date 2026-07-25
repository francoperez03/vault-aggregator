'use client';

import { useChainId, useSwitchChain } from 'wagmi';
import { activeChain } from '@/lib/wagmi/chain';

/** Short network suffix for the copy contract's "Cambiá a Arbitrum {network} para continuar."
 * (14-UI-SPEC.md §Copywriting Contract) — `getChainLabel` already includes "Arbitrum". */
const NETWORK_SUFFIX: Record<number, string> = {
  42161: 'One',
  421614: 'Sepolia',
};

interface UseNetworkGuardResult {
  /** True once a wallet is connected on a chain other than `activeChain`. Reads must stay
   * disabled while this is true (T-14-08-03): a wrong-network read returns real values from
   * the wrong chain, which looks identical to a correct zero balance. */
  isWrongNetwork: boolean;
  expectedName: string;
  switchNetwork: () => void;
}

/** Detects a connected wallet on the wrong chain and offers the "Cambiar de red" CTA
 * (14-UI-SPEC.md §Copywriting Contract, network mismatch row). */
export function useNetworkGuard(): UseNetworkGuardResult {
  const chainId = useChainId();
  const { switchChain } = useSwitchChain();

  const isWrongNetwork = chainId !== activeChain.id;
  const expectedName = NETWORK_SUFFIX[activeChain.id] ?? activeChain.name;

  return {
    isWrongNetwork,
    expectedName,
    switchNetwork: () => switchChain({ chainId: activeChain.id }),
  };
}
