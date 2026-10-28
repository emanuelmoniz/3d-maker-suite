import { spawn } from "node:child_process";
import { mkdirSync, readFileSync } from "node:fs";
import { createServer, type IncomingHttpHeaders, type IncomingMessage } from "node:http";
import { hostname } from "node:os";
import { type Link, type LinkStatus, PairError, type PairErrorCode } from "./hub.ts";
import type { Store } from "./state.ts";
import type { Updater } from "./update.ts";

type Messages = { [k: string]: string | Messages };
const en: Messages = JSON.parse(
  readFileSync(new URL("./locales/en/connector.json", import.meta.url), "utf8"),
);
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/** A `connector:` key from locales/en as HTML, `{{name}}` filled in and escaped. Only EN ships. */
export function t(key: string, vars: Record<string, string> = {}) {
  let text: string | Messages | undefined = en;
  for (const k of key.replace(/^connector:/, "").split("."))
    text = typeof text === "object" ? text[k] : undefined;
  if (typeof text !== "string") return esc(key);
  return esc(text).replace(/\{\{(\w+)\}\}/g, (_, k: string) => esc(vars[k] ?? ""));
}

// Literal keys, so the i18n check sees them.
const STATES: Record<Exclude<LinkStatus, "unpaired" | "revoked">, string> = {
  connecting: "connector:status.states.connecting",
  online: "connector:status.states.online",
  offline: "connector:status.states.offline",
  hubOff: "connector:status.states.hubOff",
};
const PAIR_ERRORS: Record<PairErrorCode, string> = {
  badUrl: "connector:pair.errors.badUrl",
  unreachable: "connector:pair.errors.unreachable",
  invalidCode: "connector:pair.errors.invalidCode",
  tooManyAttempts: "connector:pair.errors.tooManyAttempts",
  hubOff: "connector:pair.errors.hubOff",
};

/**
 * The page's own requests only. Host must be ours, so a DNS-rebinding site can't reach it; a POST
 * must come from this page (Origin), or any website could pair the connector with its own hub.
 */
export function allowed(method: string | undefined, headers: IncomingHttpHeaders, port: number) {
  const ours = [`127.0.0.1:${port}`, `localhost:${port}`];
  if (!ours.includes(headers.host ?? "")) return false;
  return method === "GET" || ours.some((h) => headers.origin === `http://${h}`);
}

const openFolder = (dir: string) => {
  const cmd = { win32: "explorer.exe", darwin: "open" }[process.platform as string] ?? "xdg-open";
  spawn(cmd, [dir], { stdio: "ignore", detached: true })
    .on("error", () => {})
    .unref();
};

async function readForm(req: IncomingMessage) {
  let body = "";
  for await (const chunk of req) {
    body += chunk;
    if (body.length > 10_000) throw new Error("form too large");
  }
  return new URLSearchParams(body);
}

const CSS = `
:root { color-scheme: light dark; --bg: #f7f7f8; --fg: #1b1b1f; --muted: #5d5d66; --card: #fff;
  --line: #dcdce1; --accent: #2457d6; --ok: #19734a; --warn: #9a5b00; --bad: #b42318; }
@media (prefers-color-scheme: dark) { :root { --bg: #131316; --fg: #ececf1; --muted: #a3a3ad;
  --card: #1c1c21; --line: #34343c; --accent: #7aa2ff; --ok: #4cc38a; --warn: #f0b04a; --bad: #ff8a80; } }
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--fg); font: 16px/1.5 system-ui, sans-serif; }
main { max-width: 34rem; margin: 0 auto; padding: 2rem 1rem; }
h1 { font-size: 1.4rem; margin: 0 0 1.5rem; } h2 { font-size: 1.1rem; margin: 0 0 .5rem; }
section { background: var(--card); border: 1px solid var(--line); border-radius: .75rem; padding: 1.25rem; }
dl { display: grid; grid-template-columns: max-content 1fr; gap: .5rem 1rem; margin: 0 0 1rem; }
dt { color: var(--muted); } dd { margin: 0; overflow-wrap: anywhere; }
label { display: block; font-weight: 600; margin-top: 1rem; }
input { width: 100%; font: inherit; padding: .5rem .6rem; margin-top: .25rem; border: 1px solid var(--line);
  border-radius: .5rem; background: var(--bg); color: var(--fg); }
small, .muted { color: var(--muted); font-size: .875rem; }
button { font: inherit; font-weight: 600; padding: .5rem 1rem; border-radius: .5rem; border: 0;
  background: var(--accent); color: var(--card); cursor: pointer; margin-top: 1rem; }
:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
a { color: var(--accent); }
.online { color: var(--ok); } .connecting, .hubOff { color: var(--warn); } .offline, .error { color: var(--bad); }
.row { display: flex; flex-wrap: wrap; gap: 1rem; align-items: center; }
`;

type Options = {
  link: Link;
  store: Store;
  updater: Pick<Updater, "state">;
  version: string;
  syncDir: string;
  open?: (dir: string) => void;
};

/** The connector's only UI (ADR-0014): pair, hub, state, sync folder. 127.0.0.1 only. */
export function createStatusPage({
  link,
  store,
  updater,
  version,
  syncDir,
  open = openFolder,
}: Options) {
  const pairForm = (error?: PairErrorCode, form?: URLSearchParams) => {
    const state = store.get();
    const value = (k: string, fallback = "") => esc(form?.get(k) ?? fallback);
    return `<section aria-labelledby="pair">
<h2 id="pair">${t("connector:pair.title")}</h2>
${link.state().status === "revoked" ? `<p class="error" role="alert">${t("connector:pair.revoked")}</p>` : ""}
<p class="muted">${t("connector:pair.intro")}</p>
${error ? `<p class="error" role="alert">${t(PAIR_ERRORS[error])}</p>` : ""}
<form method="post" action="/pair">
<label for="hub">${t("connector:pair.hubUrl")}</label>
<input id="hub" name="hub" type="url" required aria-describedby="hub-hint" value="${value("hub", state.hubUrl)}">
<small id="hub-hint">${t("connector:pair.hubUrlHint")}</small>
<label for="code">${t("connector:pair.code")}</label>
<input id="code" name="code" required maxlength="20" autocomplete="off" autocapitalize="characters" spellcheck="false">
<label for="name">${t("connector:pair.name")}</label>
<input id="name" name="name" required maxlength="100" value="${value("name", state.deviceName ?? hostname())}">
<button type="submit">${t("connector:pair.submit")}</button>
</form>
</section>`;
  };

  const statusView = (status: keyof typeof STATES, error?: string) => {
    const state = store.get();
    const update = updater.state();
    const note = (html: string) => `<p class="muted" role="status">${html}</p>`;
    return `<section>
<dl>
<dt>${t("connector:status.hub")}</dt><dd><a href="${esc(state.hubUrl ?? "")}">${esc(state.hubUrl ?? "")}</a></dd>
<dt>${t("connector:status.device")}</dt><dd>${esc(state.deviceName ?? "")}</dd>
<dt>${t("connector:status.state")}</dt><dd class="${status}">${t(STATES[status])}</dd>
<dt>${t("connector:status.version")}</dt><dd>${esc(version)}</dd>
<dt>${t("connector:status.syncFolder")}</dt><dd>${esc(syncDir)}</dd>
</dl>
${error ? `<p class="error">${t("connector:status.lastError", { error })}</p>` : ""}
${update.failed ? note(t("connector:status.updateFailed", { version: update.failed, current: version })) : ""}
${update.error ? note(t("connector:status.updateError", { error: update.error })) : ""}
${update.hubOlder ? note(t("connector:status.hubOlder")) : ""}
<div class="row">
<form method="post" action="/open-folder"><button type="submit">${t("connector:status.openFolder")}</button></form>
<a href="${esc(state.hubUrl ?? "")}">${t("connector:status.openApp")}</a>
</div>
<p class="muted">${t("connector:status.manage")}</p>
</section>`;
  };

  const page = (body: string, refresh: boolean) => `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
${refresh ? '<meta http-equiv="refresh" content="5">' : ""}
<title>${t("connector:appName")}</title>
<style>${CSS}</style>
</head>
<body><main>
<h1>${t("connector:appName")}</h1>
${body}
</main></body>
</html>`;

  const render = (error?: PairErrorCode, form?: URLSearchParams) => {
    const { status: s, error: e } = link.state();
    // Refreshes only the status view, so it never wipes what someone is typing.
    return s === "unpaired" || s === "revoked"
      ? page(pairForm(error, form), false)
      : page(statusView(s, e), true);
  };

  return createServer(async (req, res) => {
    const send = (code: number, type: string, body: string) =>
      res.writeHead(code, { "content-type": type, "cache-control": "no-store" }).end(body);
    const html = "text/html; charset=utf-8";
    const back = () => res.writeHead(303, { location: "/" }).end();
    if (!allowed(req.method, req.headers, req.socket.localPort ?? 0))
      return send(403, "text/plain", "Forbidden");
    const path = new URL(req.url ?? "/", "http://x").pathname;
    try {
      if (req.method === "GET" && path === "/api/health")
        return send(200, "application/json", JSON.stringify({ status: "ok", version }));
      if (req.method === "GET" && path === "/") return send(200, html, render());
      if (req.method === "POST" && path === "/pair") {
        const form = await readForm(req);
        const name = form.get("name")?.trim() || hostname();
        try {
          await link.pair(form.get("hub") ?? "", form.get("code") ?? "", name);
        } catch (e) {
          if (e instanceof PairError) return send(400, html, render(e.code, form));
          throw e;
        }
        return back();
      }
      if (req.method === "POST" && path === "/open-folder") {
        mkdirSync(syncDir, { recursive: true });
        open(syncDir);
        return back();
      }
      send(404, "text/plain", "Not found");
    } catch {
      send(500, "text/plain", "Error");
    }
  });
}
