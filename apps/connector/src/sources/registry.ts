import { bambuLanAdapter } from "@3d-maker-suite/adapter-bambu";
import { moonrakerAdapter } from "@3d-maker-suite/adapter-moonraker";
import { octoprintAdapter } from "@3d-maker-suite/adapter-octoprint";
import { prusalinkAdapter } from "@3d-maker-suite/adapter-prusalink";
import { spoolmanAdapter } from "@3d-maker-suite/adapter-spoolman";
import type { IntegrationAdapter } from "@3d-maker-suite/core";

// The connector's composition root (ADR-0015, LAN reach), the second of two with the server's
// (apps/server/src/integrations/registry.ts): the printers and the spool library on the network it
// can reach for a hub. Only a printer's read parts run here (status, printers and history); a spool
// library's reads and its usage writes (ADR-0014, 2026-11-17 Step 14b amendment). A printer or
// spool library adapter added to the server is added here too, or a hub can't reach it through a
// connector.
export const sourceAdapters = (): IntegrationAdapter[] => [
  bambuLanAdapter(),
  moonrakerAdapter(),
  octoprintAdapter(),
  prusalinkAdapter(),
  spoolmanAdapter(),
];
