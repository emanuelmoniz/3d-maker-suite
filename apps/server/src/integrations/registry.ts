import {
  bambuCloudAdapter,
  bambuLanAdapter,
  bambuStudioAdapter,
  bambuStudioServerAdapter,
  bambuStudioWorkerAdapter,
} from "@3d-maker-suite/adapter-bambu";
import { mockAdapter } from "@3d-maker-suite/adapter-mock";
import { moonrakerAdapter } from "@3d-maker-suite/adapter-moonraker";
import { octoprintAdapter } from "@3d-maker-suite/adapter-octoprint";
import {
  orcaSlicerAdapter,
  orcaSlicerServerAdapter,
  orcaSlicerWorkerAdapter,
} from "@3d-maker-suite/adapter-orca";
import { prusalinkAdapter } from "@3d-maker-suite/adapter-prusalink";
import { spoolmanAdapter } from "@3d-maker-suite/adapter-spoolman";
import type { IntegrationAdapter } from "@3d-maker-suite/core";

// Composition root: with the connector's apps/connector/src/printers/registry.ts, the only
// non-test files that may import an adapter package (ADR-0003). Adding a vendor = add its package
// to apps/server/package.json and one entry here; a printer on the network goes in the connector's
// registry too, so a hub can reach it through a connector (ADR-0015).
export const adapters = (opts: { mock: boolean }): IntegrationAdapter[] => [
  bambuCloudAdapter(),
  bambuLanAdapter(),
  moonrakerAdapter(),
  octoprintAdapter(),
  prusalinkAdapter(),
  spoolmanAdapter(),
  bambuStudioAdapter(),
  orcaSlicerAdapter(),
  bambuStudioServerAdapter(),
  orcaSlicerServerAdapter(),
  bambuStudioWorkerAdapter(),
  orcaSlicerWorkerAdapter(),
  ...(opts.mock ? [mockAdapter()] : []),
];
