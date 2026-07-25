import { getDefaultConfig, getDefaultWallets } from '@rainbow-me/rainbowkit';
import { rabbyWallet } from '@rainbow-me/rainbowkit/wallets';
import { createConfig, http } from 'wagmi';
import { injected } from 'wagmi/connectors';
import { activeChain } from '@/lib/wagmi/chain';

function getWalletConnectProjectId(): string | undefined {
  const id = process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID?.trim();
  if (!id || /^0+$/.test(id)) return undefined;
  return id;
}

const projectId = getWalletConnectProjectId();

/** Injected-only config for local dev / CI when WalletConnect Cloud is not configured. */
function createInjectedConfig() {
  const chain = activeChain;
  return createConfig({
    chains: [chain],
    connectors: [injected()],
    transports: {
      [chain.id]: http(),
    } as Record<(typeof chain)['id'], ReturnType<typeof http>>,
    ssr: true,
  });
}

/** RainbowKit's stock list plus Rabby, appended to the first group so it sits with the other
 * popular wallets instead of in a section of its own. */
function walletListWithRabby() {
  const [popular, ...rest] = getDefaultWallets().wallets;
  if (!popular) return [{ groupName: 'Popular', wallets: [rabbyWallet] }];
  return [{ ...popular, wallets: [...popular.wallets, rabbyWallet] }, ...rest];
}

export const wagmiConfig = projectId
  ? getDefaultConfig({
      appName: 'Vault Aggregator',
      projectId,
      chains: [activeChain],
      wallets: walletListWithRabby(),
      ssr: true,
    })
  : createInjectedConfig();

export const hasWalletConnect = Boolean(projectId);

export { activeChain };
