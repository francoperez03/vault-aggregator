import type { AdapterId } from '@/lib/contracts/config';
import { ADAPTER_IDS } from '@/lib/contracts/config';

export type AllocationBps = Partial<Record<AdapterId, number>>;

/** D-16: a slider at 0% means "leave this protocol", so the entry is omitted from the arrays.
 *  The contract rejects zero weights outright (12.1 D-04). */
export function toContractWeights(
  allocation: AllocationBps,
  addresses: Partial<Record<AdapterId, `0x${string}`>>,
): { adapters: `0x${string}`[]; bps: bigint[] } {
  const adapters: `0x${string}`[] = [];
  const bps: bigint[] = [];

  for (const id of ADAPTER_IDS) {
    const weight = allocation[id] ?? 0;
    if (weight === 0) continue;
    const address = addresses[id];
    if (!address) throw new Error(`Falta la dirección del adapter ${id}.`);
    adapters.push(address);
    bps.push(BigInt(weight));
  }

  if (adapters.length === 0) throw new Error('No se puede rebalancear: todos los pesos están en cero.');

  return { adapters, bps };
}

export function sumBps(allocation: AllocationBps): number {
  return ADAPTER_IDS.reduce((sum, id) => sum + (allocation[id] ?? 0), 0);
}

/** Rounding remainder goes to the first slice, mirroring share_math::split_by_bps (F11 D-10). */
export function normalizeToBps(percentages: Partial<Record<AdapterId, number>>): AllocationBps {
  const total = ADAPTER_IDS.reduce((sum, id) => sum + (percentages[id] ?? 0), 0);
  const result = {} as Record<AdapterId, number>;

  if (total <= 0) {
    for (const id of ADAPTER_IDS) result[id] = 0;
    return result;
  }

  let assigned = 0;
  for (const id of ADAPTER_IDS) {
    const pct = percentages[id] ?? 0;
    const share = Math.floor((pct * 10000) / total);
    result[id] = share;
    assigned += share;
  }
  result[ADAPTER_IDS[0]] += 10000 - assigned;

  return result;
}

/**
 * Moves one slider and pays for it with the others, so the four always sum to 100 and the user
 * never has to do the arithmetic. The cost is shared **proportionally**: a protocol holding twice
 * as much gives up twice as much.
 *
 * Proportional beats a fixed 1-2-3-4 priority order here. An order is one more thing to explain,
 * to display, and to let the user edit, and it makes the same drag behave differently depending on
 * a setting nobody remembers changing — while proportional needs no configuration and preserves
 * the shape of the allocation the user already chose.
 *
 * A protocol sitting at 0% stays at 0%: dropping one is a decision (D-16 omits it from the tx), and
 * dragging a different slider must not quietly resurrect it. The one exception is when *every*
 * other protocol is at 0 and there is a remainder to place — then it splits equally, because the
 * alternative is refusing the drag with no way for the user to see why.
 */
export function redistribute(
  current: Partial<Record<AdapterId, number>>,
  changed: AdapterId,
  next: number,
): Record<AdapterId, number> {
  const target = Math.min(100, Math.max(0, Math.round(next)));
  const others = ADAPTER_IDS.filter((id) => id !== changed);
  const remaining = 100 - target;
  const othersTotal = others.reduce((sum, id) => sum + (current[id] ?? 0), 0);

  const result = {} as Record<AdapterId, number>;
  result[changed] = target;

  // Largest-remainder apportionment: floor everything, then hand the leftover points to whoever
  // was cut hardest. Rounding each independently would drift the total off 100.
  const exact = others.map((id) => {
    const weight = othersTotal > 0 ? (current[id] ?? 0) / othersTotal : 1 / others.length;
    return { id, value: remaining * weight };
  });

  let assigned = 0;
  for (const { id, value } of exact) {
    result[id] = Math.floor(value);
    assigned += result[id];
  }

  const leftovers = exact
    .map(({ id, value }) => ({ id, fraction: value - Math.floor(value) }))
    .sort((a, b) => b.fraction - a.fraction);

  for (let i = 0; assigned < remaining; i++, assigned++) {
    result[leftovers[i % leftovers.length].id] += 1;
  }

  return result;
}
