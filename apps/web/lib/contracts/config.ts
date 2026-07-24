export const ADAPTER_IDS = ['morpho', 'fluid', 'euler', 'aave'] as const;

export type AdapterId = (typeof ADAPTER_IDS)[number];

function readAddress(value: string | undefined): `0x${string}` | undefined {
  if (!value || !/^0x[a-fA-F0-9]{40}$/.test(value)) return undefined;
  return value as `0x${string}`;
}

export function getCoreAddress(): `0x${string}` | undefined {
  return readAddress(process.env.NEXT_PUBLIC_CORE_ADDRESS);
}

export function getUsdcAddress(): `0x${string}` | undefined {
  return readAddress(process.env.NEXT_PUBLIC_USDC_ADDRESS);
}

function getMorphoAdapterAddress(): `0x${string}` | undefined {
  return readAddress(process.env.NEXT_PUBLIC_MORPHO_ADAPTER_ADDRESS);
}

function getFluidAdapterAddress(): `0x${string}` | undefined {
  return readAddress(process.env.NEXT_PUBLIC_FLUID_ADAPTER_ADDRESS);
}

function getEulerAdapterAddress(): `0x${string}` | undefined {
  return readAddress(process.env.NEXT_PUBLIC_EULER_ADAPTER_ADDRESS);
}

function getAaveAdapterAddress(): `0x${string}` | undefined {
  return readAddress(process.env.NEXT_PUBLIC_AAVE_ADAPTER_ADDRESS);
}

/** Deliberately only these six addresses: the core, USDC and the four adapters. There is no
 * second contract to configure here, and no extra approval-target constant (D-08). */
export function getAdapterAddresses(): Partial<Record<AdapterId, `0x${string}`>> {
  const addresses: Partial<Record<AdapterId, `0x${string}`>> = {
    morpho: getMorphoAdapterAddress(),
    fluid: getFluidAdapterAddress(),
    euler: getEulerAdapterAddress(),
    aave: getAaveAdapterAddress(),
  };
  for (const id of ADAPTER_IDS) {
    if (!addresses[id]) delete addresses[id];
  }
  return addresses;
}

export function isContractConfigured(): boolean {
  const adapters = getAdapterAddresses();
  return Boolean(
    getCoreAddress() &&
      getUsdcAddress() &&
      ADAPTER_IDS.every((id) => adapters[id]),
  );
}
