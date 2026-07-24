export interface Vault {
  id: string
  protocol: string
  name: string
  vaultAddress: string
  underlyingAsset: string
  apy: number
  strategyType: string
  logoUrl?: string
}

export type Allocation = Record<string, number>
