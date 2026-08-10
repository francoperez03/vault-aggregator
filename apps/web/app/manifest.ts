import type { MetadataRoute } from 'next'

/**
 * Installable manifest, which is also what a store listing reads for the name and the icon set.
 * `purpose: 'maskable'` on the 512 matters: Android crops icons to its own shape, and the mark sits
 * inside the safe circle precisely so that crop never clips it.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Vaulty',
    short_name: 'Vaulty',
    description:
      'Tu USDC rindiendo en los mejores protocolos de Arbitrum, repartido como vos digas.',
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
