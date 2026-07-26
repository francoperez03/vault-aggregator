import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// Allow the Lemon in-app QA tunnel to load Next dev chunks over ngrok (fixes 403 + infinite
// "Loading…" on mobile). Reuses CoinFlip's reserved ngrok host so Lemon's existing mini-app
// registration (531c…) resolves to this app; override with NGROK_HOST.
const ngrokHost = process.env.NGROK_HOST?.trim() ?? 'christian-actinographic-impliedly.ngrok-free.dev'

/** @type {import('next').NextConfig} */
const nextConfig = {
  allowedDevOrigins: [ngrokHost],
  typescript: {
    ignoreBuildErrors: true,
  },
  images: {
    unoptimized: true,
  },
  turbopack: {
    root: __dirname,
  },
  // @coinbase/cdp-sdk is an optional transitive dependency of wagmi's Base Account connector
  // (unused: no Base/Coinbase wallet-specific x402 payment flow here). Its dynamic
  // `import("@x402/svm/exact/client")` etc. are optional peer deps genuinely absent from
  // node_modules; bundling this package makes Turbopack try to statically resolve them and fail
  // the build. Marking it external skips bundling and resolves it (or fails gracefully) at
  // runtime instead, matching its own optional-dependency design.
  serverExternalPackages: ['@coinbase/cdp-sdk'],
}

export default nextConfig
