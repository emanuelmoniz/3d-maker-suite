import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { openDb } from "@3d-maker-suite/db";
import fastifyStatic from "@fastify/static";
import { buildApp } from "./app.ts";
import { loadConfig } from "./config.ts";

const config = loadConfig();
mkdirSync(config.dataDir, { recursive: true });

const app = await buildApp(
  openDb(join(config.dataDir, "app.sqlite")),
  {
    // Never log credentials (secrets rule in CLAUDE.md).
    redact: ["req.headers.authorization", "req.headers.cookie"],
  },
  config.dataDir,
);
await app.register(fastifyStatic, {
  root: fileURLToPath(new URL("../../web/dist", import.meta.url)),
});
await app.listen({ host: config.host, port: config.port });
