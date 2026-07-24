import type { Vault } from '@/types'

export const VAULTS: Vault[] = [
  {
    id: 'aave',
    protocol: 'Aave',
    name: 'Aave USDC Vault',
    vaultAddress: '0x...',
    underlyingAsset: 'USDC',
    apy: 4.2,
    strategyType: 'Lending',
    logoUrl: '/vault-logos/aave.svg',
  },
  {
    id: 'morpho',
    protocol: 'Morpho',
    name: 'Morpho USDC Vault',
    vaultAddress: '0x...',
    underlyingAsset: 'USDC',
    apy: 5.8,
    strategyType: 'Meta-Morpho',
    logoUrl: '/vault-logos/morpho.png',
  },
  {
    id: 'fluid',
    protocol: 'Fluid',
    name: 'Fluid USDC Vault',
    vaultAddress: '0x...',
    underlyingAsset: 'USDC',
    apy: 4.9,
    strategyType: 'Lending',
    logoUrl: '/vault-logos/fluid.png',
  },
  {
    id: 'beefy',
    protocol: 'Beefy',
    name: 'Beefy USDC Vault',
    vaultAddress: '0x...',
    underlyingAsset: 'USDC',
    apy: 6.1,
    strategyType: 'Yield Optimizer',
    logoUrl: '/vault-logos/beefy.png',
  },
]

export function getWeightedApy(allocations: Record<string, number>): number {
  let total = 0
  for (const vault of VAULTS) {
    const pct = allocations[vault.id] ?? 0
    total += (vault.apy * pct) / 100
  }
  return total
}

export function getYieldPerSecond(balance: number, apy: number): number {
  if (balance <= 0 || apy <= 0) return 0
  return (balance * (apy / 100)) / (365 * 24 * 60 * 60)
}
