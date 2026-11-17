import { bambuLanAdapter } from "@3d-maker-suite/adapter-bambu";
import { moonrakerAdapter } from "@3d-maker-suite/adapter-moonraker";
import { octoprintAdapter } from "@3d-maker-suite/adapter-octoprint";
import { prusalinkAdapter } from "@3d-maker-suite/adapter-prusalink";
import type { IntegrationAdapter } from "@3d-maker-suite/core";

// The connector's composition root (ADR-0015, LAN reach), the second of two with the server's
// (apps/server/src/integrations/registry.ts): the printers on the network it can reach for a hub.
// Only their read parts run here: status, printers and history. A printer adapter added to the
// server is added here too, or a hub can't reach it through a connector.
export const printerAdapters = (): IntegrationAdapter[] => [
  bambuLanAdapter(),
  moonrakerAdapter(),
  octoprintAdapter(),
  prusalinkAdapter(),
];
