# M2 Runbook — Arbitrum One

Operational record for the Vault Aggregator's live work on **Arbitrum One (chain id 42161)**.
Everything here spends real funds. Phase 8's fork-tooling spike returned NEITHER (no viable fork
node, `TestVM::rpc_url()` cannot fork external calls), so small real-USDC transactions against
the real vaults are the frozen substitute for fork tests (ADR 001, D-05) — not a fallback.

## M2 wallet

| | |
|---|---|
| Address | `0x13B56eA93CB18ae90d7Ff6E01Cb97C1AbFB2B992` |
| Created | 2026-07-22, `cast wallet new` (nonce 0 at funding time) |
| Private key | `~/.wakeup-m2-arb1.key`, chmod 600, outside every repo — never committed, never in `.env` |
| Role | Deployer **and** the interim EOA core of every adapter instance below (D-04) |

Dedicated to M2. The M1 deployer `0xD245710638f66A16386df955D45e65d13B0C0E3e` is deliberately
not reused (D-07). This wallet is never funded beyond the working amount and owns nothing in
production.

### Funding

| Asset | Amount | Contract |
|---|---|---|
| ETH (gas) | 0.002278331593910000 | native |
| USDC | 10.000000 | `0xaf88d065e77c8cC2239327C5EDb3A432268e5831` (**native** USDC, 6 decimals) |

Bridged USDC.e (`0xFF970A61A04b1cA14834A43f5dE4533eBDDB5CC8`) is unusable by these tests —
verified at 0 on this wallet.

Balance checks:

```bash
cast balance 0x13B56eA93CB18ae90d7Ff6E01Cb97C1AbFB2B992 --rpc-url https://arb1.arbitrum.io/rpc
cast call 0xaf88d065e77c8cC2239327C5EDb3A432268e5831 "balanceOf(address)(uint256)" \
  0x13B56eA93CB18ae90d7Ff6E01Cb97C1AbFB2B992 --rpc-url https://arb1.arbitrum.io/rpc
```

## Deployed adapter instances

Three instances of the **same** WASM (12,577 bytes under the reproducible Docker build), one per
protocol — one blueprint, three instances, never one instance serving three vaults (D-01).
Deployed and init'd by `scripts/deploy-adapters.sh` on 2026-07-22.

These instances are **disposable**: Phase 11 deploys production instances pointed at the real
core contract. No fund migration from these is designed (T-09-24, accepted).

| Protocol | Adapter | Vault | Deploy tx | Init tx |
|---|---|---|---|---|
| Morpho `gtUSDCc` | `0xdb4010382d4b07d77c2d78dc3f0b4c83a1f9c7a3` | `0x7e97fa6893871A2751B5fE961978DCCb2c201E65` | `0xca5a2ea7508970c1daf8e0ed532da725acd36b529629363f88370ee2f3cd7e41` | `0x015909b8a992575bdd285950a350cee1a99189b96c99a4512e223a89ca030c41` |
| Fluid `fUSDC` | `0xbd5d02430e8d8532e486e91a7a52cf0cf770494a` | `0x1A996cb54bb95462040408C06122D45D6Cdb6096` | `0xcc5864303ad4dcd6ec70759b4ddcfa5511166d210dafc0c924e55383c434e390` | `0x77a9652b08dfed8eae3e174a5c72c66a659b5cee726bd9039ad8486c07938396` |
| Euler `eUSDC-2` | `0x1e69c0453ce9485487a12cb25542ccebcf98cf39` | `0x6afb8d3f6d4a34e9cb2f217317f4dc8e05aa673b` | `0x455743cc4a01ec3feff6225cd8a477ada9e433f5be8e0b97dd06c3004a75d8e7` | `0x662d386011143c1dfccce60dcfa0f6b9f93e67cf6d1cbefc6ea3a22379a6ce76` |

Activation tx (paid **once** — all three share a codehash, the 2nd and 3rd deploys logged
`wasm already activated!`): `0xa6dd1f0278ed03e8100b031dd440f370c89de57f661db302256beab390ea2181`,
`wasm data fee` 0.000101 ETH.

Each instance's `core` is the M2 wallet itself.

Deployment nonces, cross-checked with `cast compute-address` (the address a CREATE from this
wallet yields at each nonce): Morpho = 0, Fluid = 3, Euler = 5.

### Wiring verification

There is no public `vault()` getter (D-01: config is immutable and unexported), so the wiring is
read from the `Initialized(address indexed vault, address indexed core)` event:

```bash
source docs/.m2-env
cast logs --from-block 486630000 --address "$MORPHO_ADAPTER_ADDR" \
  "Initialized(address,address)" --rpc-url https://arb1.arbitrum.io/rpc
```

All three confirmed pointing at their intended vault, and all three answer
`maxWithdraw()` / `totalAssets()` with `0` (no shares yet). Answering at all is the proof that
`init` took: `ensure_initialized()` runs first in every method and would otherwise revert
`NotInitialized()` (`0x87138d5c`, observed on the un-init'd instance before its init landed).

### One-shot guard proof (T-09-11)

A second `init` against each instance reverts with `AlreadyInitialized()`:

```
Error: Failed to estimate gas: server returned an error response:
error code 3: execution reverted, data: "0x0dc149f0": AlreadyInitialized
```

Accuracy note: `cast send` aborts at gas estimation, so this revert is an `eth_estimateGas`
result, not a mined failed transaction. The node still executed the call against live state, so
the guard is genuinely exercised — but the evidence is an RPC revert, not an on-chain receipt,
and it cost no gas.

## Cost actually incurred

| Stage | Transactions | ETH |
|---|---|---|
| Deploys + activation + inits | 7 | 0.000335162489610492 |
| Round-trips (incl. 2 OOG failures, 2 recoveries, 3 re-runs) | — | 0.000119631405396000 |
| **Total** | | **0.000454793895006492** |

ETH remaining: 0.001823537698903508. USDC: 10.000000 in, 9.999994 out — 6 units (6 millionths of
a dollar) lost to ERC-4626 round-down across every run. Gas price throughout: ~0.020 gwei.

The whole phase cost well under a cent of gas. The 0.01 ETH originally budgeted in the plan was
~20x the real need; 0.005 covers the rest of M2 comfortably.

## Live round-trips

```bash
source docs/.m2-env
ARB_ONE_RPC_URL=https://arb1.arbitrum.io/rpc \
M2_WALLET_KEY=$(cat ~/.wakeup-m2-arb1.key) \
  cargo test -p adapter-e2e -- --test-threads=1
```

`--test-threads=1` because all three tests spend from the same wallet and would otherwise race
on nonces. With `ARB_ONE_RPC_URL` unset the tests skip cleanly and cost nothing, which is what
keeps `cargo test --workspace` green and free.

Run on 2026-07-22, $3 (`3000000` units) per protocol. **4/4 passing.**

| Protocol | Deposit tx | Withdraw tx | Rounding loss |
|---|---|---|---|
| Morpho | `0x5be6e16497124c53a1c951e11b7e7959a79196b5f509615b5f09817635266489` | `0x119436e181fc2394a28a739fc73b32e3393a04b2b4f8bbc9e7972ce242ffba6f` | 0 units |
| Fluid | `0x0ff22d1476ed3c6878fa14a42d841819e7cb86972516aee8956d96a96cf8b6ff` | `0x46f8fb846d2354069045d82d9f88ab12e7ff4879cbd5896d388d3de4d2c42a39` | 0 units |
| Euler | `0x6ef4fc4ffac0d5a43d3276df09c236bea94a9c07c8a40f3101fa312120b2ef15` | `0x227ec4fcc4fd790a4775d40d908b6910fb99df251113c423a4c7896c575f7c22` | 1 unit |

A "unit" is a millionth of a dollar. Euler's 1-unit loss is the ERC-4626 round-down convention
working as designed — `maxWithdraw()` reported `2999999` for a `3000000` deposit, and the test's
2-unit tolerance covers it. Every position was closed: all three adapters read `totalAssets() == 0`
afterwards, and the wallet ended at 9.999994 USDC (6 units lost across every run, including the
two failed attempts below).

### FLUID-THROTTLE: RESOLVED

`withdraw(maxWithdraw())` **succeeded** on live state — Fluid's `maxWithdraw` does not over-report
for this position size. `withdraw(maxWithdraw() + 1)` reverted with the adapter's own
`WithdrawExceedsMax` (`0xd9ea4d85`). Full verdict and its scope limits in `PROTOCOL-PROBES.md`:
the probe was ~$3 against ~6.78M USDC of capacity, so it confirms the reading is trustworthy far
below the throttle, not that it clamps at it.

### Gas estimation under-reports for Stylus calls (two live OOG failures)

Both round-trip failures on the first pass were **out-of-gas, not logic reverts** — each mined at
`status=0` with `gasUsed ≈ gasLimit`, while the identical call replayed through `eth_call`
returned successfully:

| Vault | Failed tx | `eth_estimateGas` | Mined OOG at | Actually needed |
|---|---|---|---|---|
| Euler | `0x835ae1fde1efe264000a5ec82e070687fc9d3b513f8f0e22a2cf53def22ba694` | 217,692 | 217,692 | 198,382 |
| Morpho | `0xb2e1853b29dd9f36ad200c9934b8008fda56cfa7499841e94aaa031bb2726478` | 602,149 | 600,000 | 578,240 |

Fix: `adapter_e2e::TX_GAS_LIMIT` (2,000,000) is set explicitly on every mutating call instead of
trusting the estimate. Unused gas is refunded on Arbitrum, so the headroom is free. Morpho is the
expensive one — MetaMorpho's `withdraw` walks its market queue.

**This will bite again.** The Phase 14 frontend and the Phase 11 core both call these adapters and
will need the same buffer; a wagmi/viem `writeContract` relying on automatic estimation will
produce exactly this failure mode, and it looks like a contract bug rather than a gas problem.

Recovery txs for the two stranded positions (withdrawn with an explicit generous limit):
`0xd23de770e6fd1f31812c38ef5eb4488b7abb081ddef08ccdc2ac69ae834fb573` (Euler),
`0x75b515588733663062a705625449e840e220701cb621ddb663857ff6027b4423` (Morpho).

## Operational notes

- `cargo stylus deploy` runs the reproducible build **inside Docker**, which mounts only the
  project directory. A key in `$HOME` is invisible there (`could not open private key file`), so
  `scripts/deploy-adapters.sh` copies it to a gitignored `.deploy-key.tmp` and removes it via a
  `trap` on every exit path. Same wall M1 hit (`coinflip/packages/contracts/README.md:204`).
- `cargo stylus` colours its output, so the deployed address arrives wrapped in ANSI escapes.
  Strip them before parsing — the first run deployed successfully and then failed to parse,
  which spends the gas and loses the address to the scrollback.
- The script is resumable: export a `*_ADAPTER_ADDR` to skip that protocol's deploy, and `init`
  is idempotent (an instance that already answers `maxWithdraw()` is skipped).
