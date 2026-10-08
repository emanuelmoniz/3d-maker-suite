import { bambuCloudAdapter, bambuStudioLibrary } from "@3d-maker-suite/adapter-bambu";
import { mockAdapter } from "@3d-maker-suite/adapter-mock";
import type { FilamentLibrary, IntegrationAdapter } from "@3d-maker-suite/core";

// Composition root: the only non-test file that may import an adapter package (ADR-0003).
// Adding a vendor = add its package to apps/server/package.json and one entry here.
export const adapters = (opts: { mock: boolean }): IntegrationAdapter[] => [
  bambuCloudAdapter(),
  ...(opts.mock ? [mockAdapter()] : []),
];

export const filamentLibraries = (): FilamentLibrary[] => [bambuStudioLibrary()];
