import type { MetadataRoute } from 'next'

/**
 * Installable manifest, which is also what a store listing reads for the name and the icon set.
 * `purpose: 'maskable'` on the 512 matters: Android crops icons to its own shape, and the mark sits
 * inside the safe circle precisely so that crop never clips it.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Vault Aggregator',
    short_name: 'Vault',
    description:
      'Allocate USDC across multiple yield vaults through a single transaction. Built on Arbitrum ERC-4626.',
    start_url: '/',
    display: 'standalone',
    orientation: 'portrait',
    background_color: '#0A0C0F',
    theme_color: '#0A0C0F',
    icons: [
      { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  }
}
