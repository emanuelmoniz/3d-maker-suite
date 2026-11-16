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

// Composition root: the only non-test file that may import an adapter package (ADR-0003).
// Adding a vendor = add its package to apps/server/package.json and one entry here.
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
