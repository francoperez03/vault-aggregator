// Generated from the deployed vault-core Stylus contract.
// Function surface confirmed via `cargo stylus export-abi` (packages/contracts/vault-core), run
// against the branch that holds the deployed source and recorded in
// `.planning/phases/14-frontend-on-chain-lemon-mock/14-06-RIG-VERIFICATION.md`.
// There is no periphery contract and no Permit2-based entrypoint in this ABI: Lemon cannot
// substitute a Permit2 signature, so plain `deposit(uint256)` with `msg.sender` as the caller is
// the only entrypoint for USDC in (D-08).
export const coreAbi = [
  {
    type: 'function',
    name: 'addAdapter',
    inputs: [{ name: 'adapter', type: 'address' }],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'setEnabled',
    inputs: [
      { name: 'adapter', type: 'address' },
      { name: 'enabled', type: 'bool' },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'sharesOf',
    inputs: [
      { name: 'user', type: 'address' },
      { name: 'adapter', type: 'address' },
    ],
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'adapterTotalShares',
    inputs: [{ name: 'adapter', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'weightBpsOf',
    inputs: [
      { name: 'user', type: 'address' },
      { name: 'adapter', type: 'address' },
    ],
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'deposit',
    inputs: [{ name: 'amount', type: 'uint256' }],
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'redeem',
    inputs: [{ name: 'bps', type: 'uint256' }],
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'rebalance',
    inputs: [
      { name: 'adapters', type: 'address[]' },
      { name: 'new_weights', type: 'uint256[]' },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
] as const;

export type CoreAbi = typeof coreAbi;
