import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
// ponytail: dev-only reach into the server package so the proxy follows the configured port.
import { loadConfig } from "../server/src/config.ts";

// Re-read on every request: the port can change in Settings without restarting Vite.
const api = () => {
  const { host, port } = loadConfig(process.env, []);
  return `http://${["0.0.0.0", "::"].includes(host) ? "127.0.0.1" : host}:${port}`;
};

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    proxy: {
      "/api": {
        target: api(),
        configure: (proxy) => {
          // biome-ignore lint/suspicious/noExplicitAny: http-proxy's types don't allow swapping `web`
          const p = proxy as any;
          const web = p.web.bind(p);
          p.web = (...a: unknown[]) =>
            web(a[0], a[1], { ...(a[2] as object), target: api() }, a[3]);
        },
      },
    },
  },
});
