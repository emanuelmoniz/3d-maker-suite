// Compares t("key") usages in apps/web/src with keys in locales/en/*.json.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const src = "apps/web/src";
const files = (dir) =>
  readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? files(join(dir, e.name)) : [join(dir, e.name)],
  );
const all = files(src).map((f) => f.replaceAll("\\", "/"));

const defined = new Set();
for (const f of all.filter((f) => /locales[/]en[/].+\.json$/.test(f))) {
  const ns = f.replace(/.*[/]/, "").replace(".json", "");
  const walk = (o, p) => {
    for (const [k, v] of Object.entries(o))
      typeof v === "object" ? walk(v, `${p}.${k}`) : defined.add(`${p}.${k}`);
  };
  walk(JSON.parse(readFileSync(f, "utf8")), ns);
}

const used = new Set();
for (const f of all.filter((f) => /\.tsx?$/.test(f)))
  for (const m of readFileSync(f, "utf8").matchAll(/\bt\(\s*["']([\w.:-]+)["']/g))
    used.add(m[1].includes(":") ? m[1].replace(":", ".") : `common.${m[1]}`);

const missing = [...used].filter((k) => !defined.has(k));
const unused = [...defined].filter((k) => !used.has(k));
for (const k of missing) console.error(`missing: ${k}`);
for (const k of unused) console.error(`unused: ${k}`);
process.exit(missing.length || unused.length ? 1 : 0);
