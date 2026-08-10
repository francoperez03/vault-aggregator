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
  title: 'Vaulty',
  description: 'Tu USDC rindiendo en los mejores protocolos de Arbitrum, repartido como vos digas. Sin custodia, salida cuando quieras.',
  formatDetection: { telephone: false, email: false },
  appleWebApp: { capable: true, statusBarStyle: 'default' },
  // Icons come from the app-directory file conventions (`app/icon.svg`, `app/apple-icon.png`);
  // listing them here too would only duplicate the tags.
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
