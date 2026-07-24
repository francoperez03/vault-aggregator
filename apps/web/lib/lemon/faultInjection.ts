export type LemonCall = 'authenticate' | 'deposit' | 'callSmartContract' | 'withdraw';

export type FaultKind =
  | 'signature-rejected'
  | 'nonce-expired'
  | 'different-wallet' // authenticate
  | 'insufficient-balance'
  | 'partial'
  | 'rejected' // deposit / callSmartContract / withdraw
  | 'revert'
  | 'timeout' // callSmartContract
  | 'failed'; // withdraw / general

/** The faults D-17 lists per SDK call — also drives the fault-injection panel's options. */
export const FAULTS: Record<LemonCall, FaultKind[]> = {
  authenticate: ['signature-rejected', 'nonce-expired', 'different-wallet'],
  deposit: ['insufficient-balance', 'partial', 'rejected'],
  callSmartContract: ['rejected', 'revert', 'timeout'],
  withdraw: ['partial', 'rejected', 'failed'],
};

// Module-level store: the fault queued for the NEXT call of each kind, one-shot.
const nextFault: Record<LemonCall, FaultKind | null> = {
  authenticate: null,
  deposit: null,
  callSmartContract: null,
  withdraw: null,
};

export function setNextFault(call: LemonCall, fault: FaultKind | null): void {
  nextFault[call] = fault;
}

/** One-shot: returns the queued fault (or null) and clears it, so the next call is clean. */
export function consumeNextFault(call: LemonCall): FaultKind | null {
  const fault = nextFault[call];
  nextFault[call] = null;
  return fault;
}

export function clearFaults(): void {
  for (const call of Object.keys(nextFault) as LemonCall[]) {
    nextFault[call] = null;
  }
}

export function isFaultInjectionEnabled(): boolean {
  return process.env.NEXT_PUBLIC_FAULT_INJECTION === 'true';
}
