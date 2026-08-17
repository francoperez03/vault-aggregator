import type { Vault } from '@/types'
import { getAdapterAddresses } from '@/lib/contracts/config'

const VAULT_CATALOG: Omit<Vault, 'adapterAddress'>[] = [
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
    id: 'euler',
    protocol: 'Euler',
    name: 'Euler USDC Vault',
    vaultAddress: '0x...',
    underlyingAsset: 'USDC',
    apy: 5.3,
    strategyType: 'Lending',
    logoUrl: '/vault-logos/euler.png',
  },
]

/** apy stays mocked until F15 (D-26/VFE-02): do not animate anything with it in this phase. */
export function getVaults(): Vault[] {
  const adapters = getAdapterAddresses()
  return VAULT_CATALOG.map((vault) => ({ ...vault, adapterAddress: adapters[vault.id] }))
}

