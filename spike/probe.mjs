// Throwaway spike, Plan 6.3.0 Step 5b: run by a scheduled task as some account, it reports who it
// is, where its profile points, and what it can do on a UNC share (read, write, change events).
//   nodew.exe probe.mjs <tag> <unc> <outDir> [handoffFile]
// Writes <outDir>/<tag>.ready once it watches, waits for the spike to make changes, then <tag>.json.
import { existsSync, readdirSync, readFileSync, realpathSync, statSync, watch, writeFileSync } from "node:fs";
import { homedir, userInfo } from "node:os";
import { join } from "node:path";

const [tag, unc, outDir, handoff] = process.argv.slice(2);
const out = { tag, user: "", env: {}, ops: {}, events: [] };
const op = (name, fn) => {
  try {
    out.ops[name] = fn() ?? "ok";
  } catch (e) {
    out.ops[name] = `ERR ${e.code ?? ""} ${e.message}`.trim();
  }
};
const done = () => writeFileSync(join(outDir, `${tag}.json`), JSON.stringify(out, null, 2));
try {
  out.user = `${process.env.USERDOMAIN}\\${process.env.USERNAME} (${userInfo().username})`;
  out.env = {
    APPDATA: process.env.APPDATA,
    LOCALAPPDATA: process.env.LOCALAPPDATA,
    USERPROFILE: process.env.USERPROFILE,
    homedir: homedir(),
    profileExists: existsSync(homedir()),
    APP_DOWNLOAD_URL: process.env.APP_DOWNLOAD_URL ?? null,
  };
  op("readdir", () => readdirSync(unc).join(","));
  op("realpath", () => realpathSync.native(unc));
  op("stat", () => {
    const s = statSync(unc, { bigint: true });
    return `dev=${s.dev} ino=${s.ino}`;
  });
  op("write", () => writeFileSync(join(unc, `from-${tag}.txt`), tag));
  op("readBack", () => readFileSync(join(unc, `from-${tag}.txt`), "utf8"));
  if (handoff) op("handoff", () => readFileSync(handoff, "utf8").trim());
  let w;
  op("watch", () => {
    w = watch(unc, { recursive: true }, (type, name) =>
      out.events.push(`${type} ${name} +${Date.now() - t0}ms`),
    );
    w.on("error", (e) => out.events.push(`error ${e.code} ${e.message}`));
  });
  const t0 = Date.now();
  writeFileSync(join(outDir, `${tag}.ready`), "");
  // Its own change through the UNC path; the spike adds one locally and one through UNC as admin.
  setTimeout(() => op("writeWatched", () => writeFileSync(join(unc, `self-${tag}.txt`), tag)), 2000);
  setTimeout(() => {
    w?.close();
    done();
    process.exit(0);
  }, 15000);
} catch (e) {
  out.fatal = String(e?.stack ?? e);
  done();
}
