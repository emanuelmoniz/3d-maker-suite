import { existsSync } from "node:fs";
import { DOCS_URL } from "@3d-maker-suite/core";
import fastifyStatic from "@fastify/static";
import type { FastifyInstance } from "fastify";

/**
 * The guide that ships with the app (`pnpm guide:build`, Step 0b of Plan 6.2.0), served at `/guide/`
 * with no sign-in and no network: it is plain files from the same build as the app. A source checkout
 * that hasn't built it sends `/guide/` to the public site instead. Returns whether the copy is served.
 */
export async function registerGuide(app: FastifyInstance, root: string): Promise<boolean> {
  if (!existsSync(root)) {
    // The same page on the public site, so a Help link still lands on its section (the browser
    // keeps the `#section` across the redirect). The site is on a fixed host, so no open redirect.
    app.get("/guide", (_req, reply) => reply.redirect(DOCS_URL));
    app.get<{ Params: { "*": string } }>("/guide/*", (req, reply) =>
      reply.redirect(`${DOCS_URL}/${encodeURI(req.params["*"])}`),
    );
    app.log.info(
      `The guide isn't built, so /guide/ opens ${DOCS_URL}. Run "pnpm guide:build" to serve it from here.`,
    );
    return false;
  }
  await app.register(fastifyStatic, {
    root,
    prefix: "/guide",
    decorateReply: false,
    extensions: ["html"], // clean URLs: /guide/Printers is Printers.html
    redirect: true, // /guide -> /guide/
  });
  return true;
}
