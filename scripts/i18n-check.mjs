// Compares i18n key usages ("ns:key" string literals, or t("key") for common) in apps/web/src
// with keys in locales/en/*.json. Plural suffixes (_one, _other, ...) count as the base key.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const src = "apps/web/src";
const files = (dir) =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? files(join(dir, e.name)) : [join(dir, e.name)],
  );
const all = files(src).map((f) => f.replaceAll("\\", "/"));

const defined0 = new Set();
for (const f of all.filter((f) => /locales[/]en[/].+\.json$/.test(f))) {
  const ns = f.replace(/.*[/]/, "").replace(".json", "");
  const walk = (o, p) => {
    for (const [k, v] of Object.entries(o))
      typeof v === "object" ? walk(v, `${p}.${k}`) : defined0.add(`${p}.${k}`);
  };
  walk(JSON.parse(readFileSync(f, "utf8")), ns);
}

const plural = /_(zero|one|two|few|many|other)$/;
const defined = new Set([...defined0].map((k) => k.replace(plural, "")));
const namespaces = new Set([...defined].map((k) => k.split(".")[0]));

const used = new Set();
for (const f of all.filter((f) => /\.tsx?$/.test(f))) {
  const code = readFileSync(f, "utf8");
  for (const m of code.matchAll(/(?<![\w.])t\(\s*["']([\w.]+)["']/g)) used.add(`common.${m[1]}`);
  for (const m of code.matchAll(/["'`]([a-z]+):([\w.]+)["'`]/g))
    if (namespaces.has(m[1])) used.add(`${m[1]}.${m[2]}`);
}

// Looked up by id at runtime (`integrations:adapters.<id>.*`), so a new adapter only adds keys.
const dynamic = ["integrations.adapters."];
for (const k of defined) if (dynamic.some((p) => k.startsWith(p))) used.add(k);

const missing = [...used].filter((k) => !defined.has(k));
const unused = [...defined].filter((k) => !used.has(k));
for (const k of missing) console.error(`missing: ${k}`);
for (const k of unused) console.error(`unused: ${k}`);
process.exit(missing.length || unused.length ? 1 : 0);
