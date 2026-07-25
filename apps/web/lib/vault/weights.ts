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
