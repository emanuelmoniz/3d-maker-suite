import { ROOT_HUB, serverSystemSchema } from "@3d-maker-suite/core";
import { type Db, schema } from "@3d-maker-suite/db";
import { readSystemInfo } from "@3d-maker-suite/host";
import { eq } from "drizzle-orm";
import type { FastifyPluginAsyncZod } from "fastify-type-provider-zod";

const { roots } = schema;

/**
 * The This server card on Settings (Step 12 of 6.1.0): its CPU, memory, the drives of the data
 * directory and of the server's project folders, and its addresses. Read live, never stored.
 */
export const serverSystemRoutes =
  (
    db: Db,
    dataDir: string,
    /** In Docker the addresses are the container's, not the host's: none are given. */
    docker: boolean,
  ): FastifyPluginAsyncZod =>
  async (app) => {
    app.get("/system", { schema: { response: { 200: serverSystemSchema } } }, async () => {
      const folders = db
        .select({ path: roots.path })
        .from(roots)
        .where(eq(roots.location, ROOT_HUB))
        .all()
        .map((r) => r.path);
      const info = await readSystemInfo([...(dataDir ? [dataDir] : []), ...folders]);
      return { ...info, addresses: docker ? [] : info.addresses, docker };
    });
  };
