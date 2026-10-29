import { mkdirSync, readFileSync } from "node:fs";
import {
  createServer,
  type IncomingHttpHeaders,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { hostname } from "node:os";
import type { DeviceSyncState } from "@3d-maker-suite/core";
import { openFolder } from "@3d-maker-suite/host";
import { type Link, type LinkStatus, PairError, type PairErrorCode } from "./hub.ts";
import type { FolderError } from "./roots.ts";
import type { Store } from "./state.ts";
import { RESTART, type Updater } from "./update.ts";

type Messages = { [k: string]: string | Messages };
const en: Messages = JSON.parse(
  readFileSync(new URL("./locales/en/connector.json", import.meta.url), "utf8"),
);
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

const plurals = new Intl.PluralRules("en");

/**
 * A `connector:` key from locales/en as HTML, `{{name}}` filled in and escaped. A `count` picks the
 * plural form (`key_one`, `key_other`). Only EN ships.
 */
export function t(key: string, vars: Record<string, string | number> = {}) {
  let text: string | Messages | undefined = en;
  const path = key.replace(/^connector:/, "").split(".");
  if (typeof vars.count === "number") path.push(`${path.pop()}_${plurals.select(vars.count)}`);
  for (const k of path) text = typeof text === "object" ? text[k] : undefined;
  if (typeof text !== "string") return esc(key);
  return esc(text).replace(/\{\{(\w+)\}\}/g, (_, k: string) =>
    esc(typeof vars[k] === "number" ? vars[k].toLocaleString("en") : (vars[k] ?? "")),
  );
}

// Literal keys, so the i18n check sees them.
const STATES: Record<Exclude<LinkStatus, "unpaired" | "revoked">, string> = {
  connecting: "connector:status.states.connecting",
  online: "connector:status.states.online",
  offline: "connector:status.states.offline",
  hubOff: "connector:status.states.hubOff",
};
const SYNC_STATES: Record<DeviceSyncState["state"], string> = {
  idle: "connector:sync.states.idle",
  syncing: "connector:sync.states.syncing",
  paused: "connector:sync.states.paused",
  error: "connector:sync.states.error",
};
const FOLDER_ERRORS: Record<FolderError, string> = {
  notAbsolute: "connector:folders.errors.notAbsolute",
  notFound: "connector:folders.errors.notFound",
  covered: "connector:folders.errors.covered",
  inUse: "connector:folders.errors.inUse",
  waiting: "connector:folders.errors.waiting",
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

const openDir = (dir: string) => void openFolder(dir).catch(() => {});

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
button.danger { background: var(--bad); }
.row { display: flex; flex-wrap: wrap; gap: 1rem; align-items: center; }
`;

type Options = {
  link: Link;
  store: Store;
  updater: Pick<Updater, "state">;
  version: string;
  syncDir: string;
  open?: (dir: string) => void;
  /** Ends the connector; RESTART asks the launcher to start it again. */
  exit?: (code: number) => void;
};

/** The connector's only UI (ADR-0014): pair, hub, state, sync folder. 127.0.0.1 only. */
export function createStatusPage({
  link,
  store,
  updater,
  version,
  syncDir,
  open = openDir,
  exit = (code) => process.exit(code),
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
    const roots = link.roots.state();
    const note = (html: string) => `<p class="muted" role="status">${html}</p>`;
    return `<section>
<dl>
<dt>${t("connector:status.hub")}</dt><dd><a href="${esc(state.hubUrl ?? "")}">${esc(state.hubUrl ?? "")}</a></dd>
<dt>${t("connector:status.device")}</dt><dd>${esc(state.deviceName ?? "")}</dd>
<dt>${t("connector:status.state")}</dt><dd class="${status}">${t(STATES[status])}</dd>
<dt>${t("connector:status.version")}</dt><dd>${esc(version)}</dd>
<dt>${t("connector:status.syncFolder")}</dt><dd>${esc(syncDir)}</dd>
<dt>${t("connector:status.roots")}</dt><dd>${roots.watching}</dd>
<dt>${t("connector:folders.title")}</dt><dd>${link.roots.folders.list().map(esc).join("<br>") || t("connector:folders.none")}<br><a href="/folders">${t("connector:folders.manage")}</a></dd>
</dl>
${error ? `<p class="error">${t("connector:status.lastError", { error })}</p>` : ""}
${roots.error ? `<p class="error">${t("connector:status.rootsError", { error: roots.error })}</p>` : ""}
${update.failed ? note(t("connector:status.updateFailed", { version: update.failed, current: version })) : ""}
${update.error ? note(t("connector:status.updateError", { error: update.error })) : ""}
${update.hubOlder ? note(t("connector:status.hubOlder")) : ""}
<div class="row">
<form method="post" action="/open-folder"><button type="submit">${t("connector:status.openFolder")}</button></form>
<a href="${esc(state.hubUrl ?? "")}">${t("connector:status.openApp")}</a>
</div>
<div class="row">
<form method="post" action="/restart"><button type="submit">${t("connector:status.restart")}</button></form>
<form method="get" action="/stop"><button type="submit" class="danger">${t("connector:status.stop")}</button></form>
</div>
<p class="muted">${t("connector:status.manage")}</p>
</section>
${syncView()}`;
  };

  // The hub roots' sync; held deletes ask here, nowhere else.
  const syncView = () => {
    const s = link.sync?.state();
    if (!s) return "";
    const selected = link.sync?.mode() === "selected";
    const held = s.held
      .map(
        (h) => `<div role="alert">
<p class="error">${t("connector:sync.held", { count: h.files, root: h.name })}</p>
<div class="row">
<form method="post" action="/sync/confirm"><input type="hidden" name="root" value="${esc(h.rootId)}"><button type="submit" class="danger">${t("connector:sync.confirm")}</button></form>
<form method="post" action="/sync/restore"><input type="hidden" name="root" value="${esc(h.rootId)}"><button type="submit">${t("connector:sync.restore")}</button></form>
</div>
</div>`,
      )
      .join("\n");
    // The files this device has checked out; the slicer closing releases them too, where it can.
    const editing = (link.sync?.editing() ?? [])
      .map(
        (e) => `<li class="row"><span>${esc(e.root)}/${esc(e.path)}</span>
<form method="post" action="/sync/done"><input type="hidden" name="key" value="${esc(e.key)}"><button type="submit">${t("connector:locks.done")}</button></form></li>`,
      )
      .join("\n");
    const locks = editing
      ? `<h3>${t("connector:locks.title")}</h3>
<p class="muted">${t("connector:locks.intro")}</p>
<ul>${editing}</ul>`
      : "";
    return `<section aria-labelledby="sync">
<h2 id="sync">${t("connector:sync.title")}</h2>
<p class="muted">${t("connector:sync.intro")}</p>
<dl>
<dt>${t("connector:sync.state")}</dt><dd class="${s.state === "idle" ? "online" : s.state === "syncing" ? "connecting" : "error"}">${t(SYNC_STATES[s.state])}${s.pending ? ` · ${t("connector:sync.pending", { count: s.pending })}` : ""}</dd>
<dt>${t("connector:sync.files")}</dt><dd>${s.files.toLocaleString("en")}</dd>
</dl>
${s.error ? `<p class="error">${t("connector:sync.error", { error: s.error })}</p>` : ""}
${held}
${locks}
<p>${t(selected ? "connector:sync.mode.selected" : "connector:sync.mode.all")}</p>
<form method="post" action="/sync/mode"><input type="hidden" name="mode" value="${selected ? "all" : "selected"}"><button type="submit">${t(selected ? "connector:sync.mode.toAll" : "connector:sync.mode.toSelected")}</button></form>
</section>
${slicersView()}`;
  };

  // Open uses the default; with several and none picked, the hub asks which one each time.
  const slicersView = () => {
    const found = link.slicers.list();
    const pick = found.find((f) => f.id === store.get().defaultSlicer);
    const rows = found
      .map(
        (f) => `<li class="row"><span>${esc(f.name)}${f.version ? ` ${esc(f.version)}` : ""}</span>
${
  f === pick
    ? `<span class="muted">${t("connector:slicers.default")}</span>`
    : `<form method="post" action="/slicer"><input type="hidden" name="slicer" value="${esc(f.id)}"><button type="submit">${t("connector:slicers.makeDefault")}</button></form>`
}</li>`,
      )
      .join("\n");
    const ask = pick
      ? `<form method="post" action="/slicer"><input type="hidden" name="slicer" value=""><button type="submit">${t("connector:slicers.ask")}</button></form>`
      : `<p class="muted">${t("connector:slicers.asking")}</p>`;
    return `<section aria-labelledby="slicers">
<h2 id="slicers">${t("connector:slicers.title")}</h2>
${found.length ? `<p class="muted">${t("connector:slicers.intro")}</p><ul>${rows}</ul>${found.length > 1 ? ask : ""}` : `<p class="muted">${t("connector:slicers.none")}</p>`}
</section>`;
  };

  // Its own page: the status view's refresh would wipe a path being typed.
  const foldersView = (error?: FolderError, typed = "") => {
    const rows = link.roots.folders
      .list()
      .map(
        (f) => `<li class="row"><span>${esc(f)}</span>
<form method="post" action="/folders/remove"><input type="hidden" name="folder" value="${esc(f)}"><button type="submit" class="danger">${t("connector:folders.remove")}</button></form></li>`,
      )
      .join("\n");
    return `<section aria-labelledby="folders">
<h2 id="folders">${t("connector:folders.title")}</h2>
<p class="muted">${t("connector:folders.intro")}</p>
${error ? `<p class="error" role="alert">${t(FOLDER_ERRORS[error])}</p>` : ""}
${rows ? `<ul>${rows}</ul>` : `<p>${t("connector:folders.none")}</p>`}
<form method="post" action="/folders/add">
<label for="path">${t("connector:folders.path")}</label>
<input id="path" name="path" required maxlength="4096" spellcheck="false" aria-describedby="path-hint" value="${esc(typed)}">
<small id="path-hint">${t("connector:folders.pathHint")}</small>
<button type="submit">${t("connector:folders.add")}</button>
</form>
<p><a href="/">${t("connector:folders.back")}</a></p>
</section>`;
  };

  // Stop takes the device offline for the hub, so it asks first.
  const stopForm = `<section aria-labelledby="stop">
<h2 id="stop">${t("connector:stop.title")}</h2>
<p>${t("connector:stop.body")}</p>
<div class="row">
<form method="post" action="/stop"><button type="submit" class="danger">${t("connector:stop.confirm")}</button></form>
<a href="/">${t("connector:stop.cancel")}</a>
</div>
</section>`;
  const note = (html: string) => `<section><p role="status">${html}</p></section>`;

  const page = (body: string, refresh: boolean) => `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
${refresh ? '<meta http-equiv="refresh" content="5; url=/">' : ""}
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

  /**
   * The device id, the only answer another origin may read (ADR-0014): the hub's project page asks
   * which device it runs beside. CORS only for the hub this connector is paired with; it changes
   * nothing, and the hub still checks the device is the user's.
   */
  const answerWhoami = (req: IncomingMessage, res: ServerResponse) => {
    const { hubUrl, deviceId } = store.get();
    const hub = (() => {
      try {
        return hubUrl ? new URL(hubUrl).origin : undefined;
      } catch {
        return undefined;
      }
    })();
    const headers: Record<string, string> = { vary: "origin", "cache-control": "no-store" };
    if (hub && req.headers.origin === hub)
      Object.assign(headers, {
        "access-control-allow-origin": hub,
        "access-control-allow-methods": "GET",
        "access-control-allow-private-network": "true",
      });
    if (req.method === "OPTIONS") return res.writeHead(204, headers).end();
    if (!deviceId || !store.token()) return res.writeHead(404, headers).end();
    res.writeHead(200, { ...headers, "content-type": "application/json" });
    res.end(JSON.stringify({ id: deviceId }));
  };

  return createServer(async (req, res) => {
    const send = (code: number, type: string, body: string) =>
      res.writeHead(code, { "content-type": type, "cache-control": "no-store" }).end(body);
    const html = "text/html; charset=utf-8";
    const back = () => res.writeHead(303, { location: "/" }).end();
    const path = new URL(req.url ?? "/", "http://x").pathname;
    // whoami's preflight is a read like its GET: any Origin may ask, the Host must still be ours.
    const whoami = path === "/api/whoami" && (req.method === "GET" || req.method === "OPTIONS");
    if (!allowed(whoami ? "GET" : req.method, req.headers, req.socket.localPort ?? 0))
      return send(403, "text/plain", "Forbidden");
    try {
      if (whoami) return answerWhoami(req, res);
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
      if (req.method === "GET" && path === "/stop") return send(200, html, page(stopForm, false));
      if (req.method === "GET" && path === "/folders")
        return send(200, html, page(foldersView(), false));
      if (req.method === "POST" && (path === "/folders/add" || path === "/folders/remove")) {
        const form = await readForm(req);
        const typed = form.get("path")?.trim() ?? "";
        const error =
          path === "/folders/add"
            ? await link.roots.folders.add(typed)
            : await link.roots.folders.remove(form.get("folder") ?? "");
        if (error) return send(400, html, page(foldersView(error, typed), false));
        return res.writeHead(303, { location: "/folders" }).end();
      }
      // The answer goes out first, then the process ends.
      if (req.method === "POST" && (path === "/restart" || path === "/stop")) {
        const restart = path === "/restart";
        res.on("finish", () => exit(restart ? RESTART : 0));
        return send(
          200,
          html,
          restart
            ? page(note(t("connector:restarting")), true)
            : page(note(t("connector:stopped")), false),
        );
      }
      if (req.method === "POST" && (path === "/sync/confirm" || path === "/sync/restore")) {
        const root = (await readForm(req)).get("root") ?? "";
        const sync = link.sync;
        if (sync) void (path === "/sync/confirm" ? sync.confirm(root) : sync.restore(root));
        return back();
      }
      if (req.method === "POST" && path === "/sync/done") {
        const key = (await readForm(req)).get("key") ?? "";
        void link.sync?.done(key);
        return back();
      }
      if (req.method === "POST" && path === "/sync/mode") {
        const mode = (await readForm(req)).get("mode");
        if (mode === "all" || mode === "selected") await link.setMode(mode).catch(() => {}); // offline: the page still shows the old mode
        return back();
      }
      if (req.method === "POST" && path === "/slicer") {
        // An empty one: no default, the hub asks which slicer opens.
        const id = (await readForm(req)).get("slicer") ?? "";
        if (!id || link.slicers.list().some((f) => f.id === id)) {
          store.set({ defaultSlicer: id });
          void link.slicers.refresh(); // tells the hub
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
