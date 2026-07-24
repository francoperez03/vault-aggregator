import type { AdapterId } from '@/lib/contracts/config'

export interface Vault {
  id: AdapterId
  protocol: string
  name: string
  vaultAddress: string
  underlyingAsset: string
  apy: number
  strategyType: string
  logoUrl?: string
  adapterAddress?: `0x${string}`
}

export type Allocation = Record<string, number>
