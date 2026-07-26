'use client';

import { useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RainbowKitProvider, darkTheme } from '@rainbow-me/rainbowkit';
import { WagmiProvider } from 'wagmi';
import '@rainbow-me/rainbowkit/styles.css';
import { hasWalletConnect, wagmiConfig } from '@/lib/wagmi/config';
import { MoveQueueProvider } from '@/lib/vault/move-queue';

const rainbowTheme = darkTheme({
  accentColor: '#0052FF',
  accentColorForeground: '#FFFFFF',
  borderRadius: 'none', // the app's surfaces are square-cornered
});

export function Providers({ children }: { children: React.ReactNode }) {
  // ponytail: QueryClient created inside useState (not module scope) so SSR requests never share
  // one instance across users -- the coinflip analog uses a module-level client, but that leaks
  // cache/state across concurrent server requests under Next's SSR model.
  const [queryClient] = useState(() => new QueryClient());

  return (
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>
        <MoveQueueProvider>
          {hasWalletConnect ? (
            <RainbowKitProvider theme={rainbowTheme}>{children}</RainbowKitProvider>
          ) : (
            children
          )}
        </MoveQueueProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}
