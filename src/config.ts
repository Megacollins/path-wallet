// Typed access to the registry-projected config (written by scripts/gen-config.ts
// before dev/build). Never hardcode chain ids, RPCs, or token addresses — they
// all come from here, which comes from @rome-protocol/registry.
//
// There is one entry per live Rome chain. Components don't import a fixed chain:
// they call `useCfg()` (src/network.tsx), which returns the network the user selected.
import configJson from "./config.generated.json";
import type { PathConfig } from "../lib/assets";

const generated = configJson as unknown as { defaultChainId: number; networks: PathConfig[] };

/** Every live Rome chain the registry publishes, default first. */
export const networks: PathConfig[] = generated.networks;
export const defaultChainId: number = generated.defaultChainId;
export const defaultNetwork: PathConfig = networks.find((n) => n.chainId === defaultChainId) ?? networks[0];
