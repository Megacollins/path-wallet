// Rome redeployed its SPL wrappers (wUSDC / wETH / wSOL) in September, but @rome-protocol/registry still lists
// the OLD ones. The old wrappers reach the Helper precompile through DELEGATECALL, which the 2026-10-02 rome-evm
// release forbids, so every approve/transfer on them reverts. The new wrappers (5,575 bytes; they expose
// `isEnabled(user)`) are recorded in rome-protocol/rome-solidity `deployments/<chain>.json`.
//
// Registry is still the source of truth: an override applies ONLY while the registry lists exactly the old
// address named here. The moment the registry changes (to the new address or to anything else) the override
// steps aside and the build says so. Pure data: safe to import from the browser, the API and the scripts.
//
// Verified 2026-10-13 against both chains' RPCs: each new address has code, `isEnabled(address)` answers,
// and `mint_id()` equals the old wrapper's (same SPL mint, same balances). On Hadrian the grant → transfer flow
// was exercised end to end with a real wallet.

export const WRAPPER_OVERRIDE_SOURCE = "rome-protocol/rome-solidity deployments/{hadrian,martius}.json (2026-10-13)";

/** chainId → old registry address (lowercase) → the redeployed wrapper. */
export const WRAPPER_OVERRIDES: Record<number, Record<string, { symbol: string; use: `0x${string}` }>> = {
  200010: {
    "0xd4cc34b67c805d472b5a709a22a1037f6b16ef28": { symbol: "wUSDC", use: "0xBCE339BA4c3a8De3bB8Af1c5539e6ac11dA3112D" },
    "0x8c2c1486cadf7d07312908a065f14af65f56be7e": { symbol: "wETH", use: "0x02AEaCE038269f9961C93d04DcacD6FB3adFa55f" },
    "0x1dece035621c65a90349b56a801068b439fa4201": { symbol: "wSOL", use: "0x39f36444FcB79B3e691544AEE2a832ebef54Ca9f" },
  },
  121214: {
    "0x2fffdfa11a9cef9210dc34e975649f09119c4efb": { symbol: "wUSDC", use: "0xD3201Dc0F6fD1FE12c1FC297fb2B35927aD483B0" },
    "0x03183ee90388c9553fe9c7b019a32ce133b8e58e": { symbol: "wETH", use: "0xEf8D5bf3367cf21E24565751c0A5aAbF54caB598" },
    "0xa4dbecdcc812b9c933967a15fe5d9af420084b2b": { symbol: "wSOL", use: "0xbF378ACfFF005687595b520D3618a93dc3A104F0" },
  },
};

export type WrapperResolution = {
  address: `0x${string}`;
  /** registry: untouched · override: swapped to the redeployed wrapper · stale-override: the registry already lists the redeployed one (this entry can be deleted) */
  via: "registry" | "override" | "stale-override";
  /** Human-readable note for the build log, when something is worth saying. */
  note?: string;
};

/**
 * Which address should the app use for a wrapper the registry lists at `registryAddress`? Pass the token's symbol
 * so a registry that moves to a third, unexpected address is reported instead of silently trusted.
 */
export function resolveWrapper(chainId: number, registryAddress: string, symbol?: string): WrapperResolution {
  const addr = registryAddress as `0x${string}`;
  const table = WRAPPER_OVERRIDES[chainId];
  if (!table) return { address: addr, via: "registry" };

  const hit = table[registryAddress.toLowerCase()];
  if (hit) {
    return { address: hit.use, via: "override", note: `${hit.symbol} on chain ${chainId}: registry still lists the old wrapper ${registryAddress}; using Rome's redeployed ${hit.use}` };
  }
  const entries = Object.values(table);
  // The registry no longer lists an old address. If it lists a redeployed one, the override has done its job.
  const same = entries.find((o) => o.use.toLowerCase() === registryAddress.toLowerCase());
  if (same) {
    return { address: addr, via: "stale-override", note: `${same.symbol} on chain ${chainId}: the registry now lists ${registryAddress}, the same address as the override — delete the override entry in lib/wrappers.ts` };
  }
  const known = symbol ? entries.find((o) => o.symbol === symbol) : undefined;
  if (known) {
    return { address: addr, via: "registry", note: `${symbol} on chain ${chainId}: the registry lists ${registryAddress}, which is neither the known old wrapper nor the override ${known.use}; using the registry — re-check lib/wrappers.ts` };
  }
  return { address: addr, via: "registry" };
}
