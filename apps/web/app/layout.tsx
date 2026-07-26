import type { Metadata, Viewport } from 'next'
import { Chakra_Petch, Inter, JetBrains_Mono } from 'next/font/google'
import { Analytics } from '@vercel/analytics/next'
import { AppToaster } from '@/components/app-toaster'
import { AppShell } from '@/components/app-shell'
import { Providers } from '@/app/providers'
import './globals.css'

// Same three families as CoinFlip, same roles: Chakra Petch for display (uppercase chrome),
// Inter for body, JetBrains Mono for every number.
const inter = Inter({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-inter',
})
const chakraPetch = Chakra_Petch({
  subsets: ['latin'],
  weight: ['500', '600', '700'],
  variable: '--font-chakra-petch',
})
const jetbrainsMono = JetBrains_Mono({
  subsets: ['latin'],
  weight: ['400', '500', '600'],
  variable: '--font-jetbrains-mono',
})

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 5,
  userScalable: true,
  viewportFit: 'cover',
}

export const metadata: Metadata = {
  title: 'Vault Aggregator',
  description: 'Allocate USDC across multiple yield vaults through a single transaction. Built on Arbitrum ERC-4626.',
  generator: 'v0.app',
  formatDetection: { telephone: false, email: false },
  appleWebApp: { capable: true, statusBarStyle: 'default' },
  icons: {
    icon: [
      {
        url: '/icon-light-32x32.png',
        media: '(prefers-color-scheme: light)',
      },
      {
        url: '/icon-dark-32x32.png',
        media: '(prefers-color-scheme: dark)',
      },
      {
        url: '/icon.svg',
        type: 'image/svg+xml',
      },
    ],
    apple: '/apple-icon.png',
  },
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="en" className="dark" style={{ colorScheme: 'dark' }}>
      <body
        className={`${inter.variable} ${chakraPetch.variable} ${jetbrainsMono.variable} font-sans antialiased max-w-[430px] mx-auto min-h-dvh w-full overflow-y-auto overscroll-y-auto touch-pan-y`}
      >
        <Providers>
          <AppShell>{children}</AppShell>
          <AppToaster />
        </Providers>
        <Analytics />
      </body>
    </html>
  )
}
