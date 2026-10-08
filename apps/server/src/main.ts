import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import fastifyStatic from "@fastify/static";
import Fastify from "fastify";
import { loadConfig } from "./config.ts";

const config = loadConfig();
mkdirSync(config.dataDir, { recursive: true });

const app = Fastify({ logger: true });
await app.register(fastifyStatic, {
  root: fileURLToPath(new URL("../../web/dist", import.meta.url)),
});
await app.listen({ host: config.host, port: config.port });
