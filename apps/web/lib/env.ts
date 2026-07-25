export type AppEnv = 'development' | 'production';

/** Vercel Preview deployments always run as development unless overridden. */
function isVercelPreview(): boolean {
  return process.env.NEXT_PUBLIC_VERCEL_ENV === 'preview';
}

export function getAppEnv(): AppEnv {
  if (isVercelPreview()) return 'development';
  const env = process.env.NEXT_PUBLIC_APP_ENV;
  return env === 'production' ? 'production' : 'development';
}

export function isProductionApp(): boolean {
  return getAppEnv() === 'production';
}

export function getChainId(): number {
  const raw = process.env.NEXT_PUBLIC_CHAIN_ID;
  const parsed = raw ? Number(raw) : NaN;
  if (Number.isFinite(parsed) && parsed > 0) {
    return parsed;
  }
  return isProductionApp() ? 42161 : 421614;
}

export function getChainLabel(chainId: number): string {
  switch (chainId) {
    case 421614:
      return 'Arbitrum Sepolia';
    case 42161:
      return 'Arbitrum One';
    default:
      return `chain ${chainId}`;
  }
}
