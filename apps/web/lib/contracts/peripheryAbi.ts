// Generated from the deployed vault-periphery Stylus contract.
// Function surface confirmed via `cargo stylus export-abi` (packages/contracts/vault-periphery),
// run against the branch that holds the deployed source and recorded in
// `.planning/phases/14.1-lemon-permit2-write-path/14.1-RIG-VERIFICATION.md`.
export const peripheryAbi = [
  {
    type: 'function',
    name: 'core',
    inputs: [],
    outputs: [{ name: '', type: 'address' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'permit2',
    inputs: [],
    outputs: [{ name: '', type: 'address' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'usdc',
    inputs: [],
    outputs: [{ name: '', type: 'address' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'depositWithPermit',
    inputs: [
      { name: 'amount', type: 'uint256' },
      { name: 'nonce', type: 'uint256' },
      { name: 'deadline', type: 'uint256' },
      { name: 'signature', type: 'bytes' },
    ],
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'nonpayable',
  },
] as const;

export type PeripheryAbi = typeof peripheryAbi;
