// Typed access to the registry-projected config (written by scripts/gen-config.ts
// before dev/build). Never hardcode chain ids, RPCs, or token addresses — they
// all come from here, which comes from @rome-protocol/registry.
import configJson from "./config.generated.json";
import type { PathConfig } from "../lib/assets";

export const cfg = configJson as unknown as PathConfig;
