// Generated from the deployed vault-adapter Stylus contract (generic ERC-4626 adapter).
// Function surface confirmed via `cargo stylus export-abi` (packages/contracts/vault-adapter), run
// against the branch that holds the deployed source and recorded in
// `.planning/phases/14-frontend-on-chain-lemon-mock/14-06-RIG-VERIFICATION.md`. Only `totalAssets`
// is used by the frontend today (D-21's client-side share-math composition).
export const adapterAbi = [
  {
    type: 'function',
    name: 'totalAssets',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
  },
] as const;

export type AdapterAbi = typeof adapterAbi;
