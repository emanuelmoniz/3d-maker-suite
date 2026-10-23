// Builds the installer and the app-only zip for this OS (ADR-0011) into packaging/out/:
//   3d-maker-suite-<tag>-<os>-<arch>{-setup.exe | .dmg | .tar.gz}
//   3d-maker-suite-<tag>-app-<os>-<arch>.zip
// Needs apps/web/dist built first, and on Windows Inno Setup 6. Node stdlib + system tools only.
// node packaging/build.mjs [--arch x64] [--tag v4.1.0]
import { execFileSync, execSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  readlinkSync,
  renameSync,
  rmdirSync,
  rmSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { relink } from "./launcher.mjs";

const root = fileURLToPath(new URL("..", import.meta.url));
const here = join(root, "packaging");
const { version } = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const { values: a } = parseArgs({
  options: {
    arch: { type: "string", default: process.arch },
    tag: { type: "string", default: `v${version}` },
  },
});
const platform = process.platform;
const os = { win32: "windows", darwin: "macos", linux: "linux" }[platform];
const name = (kind) => `3d-maker-suite-${a.tag}-${kind}${os}-${a.arch}`;
const out = join(here, "out");
const work = join(out, `${platform}-${a.arch}`);
// Linux ships this folder as is, so it carries the product's name.
const stage = join(work, "3d-maker-suite");
const app = join(stage, "versions", version);
rmSync(work, { recursive: true, force: true });
mkdirSync(app, { recursive: true });
const sh = (cmd, cwd = root) => execSync(cmd, { cwd, stdio: "inherit" });
const walk = (dir, fn) => {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (fn(p, e) !== false && e.isDirectory() && !e.isSymbolicLink()) walk(p, fn);
  }
};

// 1. Node 22 (>= 22.18 for type stripping), checked against SHASUMS256.txt. Only the binary.
const get = async (url) => {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url}: ${res.status}`);
  return res;
};
const index = await (await get("https://nodejs.org/dist/index.json")).json();
const v = index.find((r) => r.version.startsWith("v22.")).version;
if (Number(v.split(".")[1]) < 18) throw new Error(`Node ${v} has no type stripping`);
const file = `node-${v}-${platform === "win32" ? "win" : platform}-${a.arch}.${platform === "win32" ? "zip" : "tar.gz"}`;
const sums = await (await get(`https://nodejs.org/dist/${v}/SHASUMS256.txt`)).text();
const want = sums
  .split("\n")
  .find((l) => l.endsWith(`  ${file}`))
  ?.split(" ")[0];
const buf = Buffer.from(await (await get(`https://nodejs.org/dist/${v}/${file}`)).arrayBuffer());
if (createHash("sha256").update(buf).digest("hex") !== want)
  throw new Error(`${file}: bad checksum`);
const tmp = join(work, "_node");
mkdirSync(tmp);
writeFileSync(join(tmp, file), buf);
execFileSync("tar", ["-xf", file], { cwd: tmp });
const from = join(tmp, file.replace(/\.(zip|tar\.gz)$/, ""));
const node = join(stage, "node");
mkdirSync(platform === "win32" ? node : join(node, "bin"), { recursive: true });
if (platform === "win32") {
  writeFileSync(join(node, "nodew.exe"), nodew(readFileSync(join(from, "node.exe"))));
} else cpSync(join(from, "bin", "node"), join(node, "bin", "node"));
cpSync(join(from, "LICENSE"), join(node, "LICENSE"));
rmSync(tmp, { recursive: true, force: true });
for (const f of ["launcher.mjs", "loader.html"]) cpSync(join(here, f), join(stage, f));

// 2. The app: the commit, the server's prod deps (hoisted: only workspace packages are links),
// the built web app. better-sqlite3 has N-API prebuilds for every platform and no install script.
sh(`git archive --format=tar HEAD | tar -x -C "${app}"`);
const cross = a.arch === process.arch ? "" : ` --cpu=${a.arch}`;
sh(
  `pnpm install --prod --frozen-lockfile --filter "@3d-maker-suite/server..." --config.node-linker=hoisted${cross}`,
  app,
);

// 3. Links: recorded with relative targets, then removed; the launcher recreates them (Inno Setup
// follows links and packs their targets twice).
const links = [];
walk(app, (p, e) => {
  if (!e.isSymbolicLink()) return;
  links.push([relative(app, p), relative(dirname(p), resolve(dirname(p), readlinkSync(p)))]);
});
for (const [p] of links) (platform === "win32" ? rmdirSync : unlinkSync)(join(app, p));
const slash = (p) => p.replaceAll("\\", "/");
writeFileSync(join(app, "links.json"), JSON.stringify(links.map(([p, t]) => [slash(p), slash(t)])));

// 4. Keep only what runs: no dev files, sources of the web app, tests, maps, types or docs.
const keep = new Set(["package.json", "LICENSE", "apps", "packages", "node_modules", "links.json"]);
for (const n of readdirSync(app)) if (!keep.has(n)) rmSync(join(app, n), { recursive: true });
for (const n of readdirSync(join(app, "apps")))
  if (n !== "server" && n !== "web") rmSync(join(app, "apps", n), { recursive: true });
for (const n of readdirSync(join(app, "apps", "web")))
  if (n !== "dist" && n !== "package.json")
    rmSync(join(app, "apps", "web", n), { recursive: true });
cpSync(join(root, "apps", "web", "dist"), join(app, "apps", "web", "dist"), { recursive: true });
walk(app, (p, e) => {
  if (e.isFile() && /\.test\.ts$/.test(e.name)) rmSync(p);
});
walk(join(app, "node_modules"), (p, e) => {
  if (e.isFile() && /\.(map|d\.[cm]?ts|md)$/.test(e.name) && !/^licen[cs]e/i.test(e.name))
    rmSync(p);
});
const sqlite = join(app, "node_modules", "better-sqlite3");
for (const d of ["deps", "src"]) rmSync(join(sqlite, d), { recursive: true, force: true });
for (const n of readdirSync(join(sqlite, "prebuilds")))
  if (n !== `${platform}-${a.arch}.node`) rmSync(join(sqlite, "prebuilds", n));
console.log(`node ${v}, app ${version}, ${links.length} links`);

// 5. The app-only zip for the updater (Windows' tar.exe crashes on a @fastify/send fixture).
const zip = (dir, to) =>
  platform === "win32"
    ? execFileSync("powershell", [
        "-NoProfile",
        "-Command",
        `Add-Type -A System.IO.Compression.FileSystem; [IO.Compression.ZipFile]::CreateFromDirectory('${dir}', '${to}', 'Optimal', $false)`,
      ])
    : execFileSync("zip", ["-qry", to, "."], { cwd: dir });
const outputs = [join(out, `${name("app-")}.zip`)];
rmSync(outputs[0], { force: true });
zip(app, outputs[0]);

// 6. The installer.
if (platform === "win32") {
  const iscc =
    [join(process.env["ProgramFiles(x86)"] ?? "", "Inno Setup 6", "ISCC.exe")].find(existsSync) ??
    "iscc";
  execFileSync(
    iscc,
    [
      "/Q",
      `/DVersion=${version}`,
      `/DSrc=${stage}`,
      `/DOutDir=${out}`,
      `/DOutName=${name("")}-setup`,
      join(here, "setup.iss"),
    ],
    { stdio: "inherit" },
  );
  outputs.push(join(out, `${name("")}-setup.exe`));
} else if (platform === "darwin") {
  // The .app holds Node, the launcher and this version; it's signed, so its links go back first.
  const dmgDir = join(work, "dmg");
  const res = join(dmgDir, "3D Maker Suite.app", "Contents", "Resources");
  cpSync(node, join(res, "node"), { recursive: true });
  for (const f of ["launcher.mjs", "loader.html"]) cpSync(join(stage, f), join(res, f));
  renameSync(app, join(res, "app"));
  relink(join(res, "app"));
  const macos = join(res, "..", "MacOS");
  mkdirSync(macos);
  writeFileSync(
    join(macos, "3d-maker-suite"),
    '#!/bin/sh\nR="$(cd "$(dirname "$0")/../Resources" && pwd)"\nexec "$R/node/bin/node" "$R/launcher.mjs"\n',
    { mode: 0o755 },
  );
  writeFileSync(join(res, "..", "Info.plist"), infoPlist());
  execFileSync("codesign", ["--force", "--deep", "-s", "-", join(dmgDir, "3D Maker Suite.app")], {
    stdio: "inherit",
  });
  execFileSync("ln", ["-s", "/Applications", join(dmgDir, "Applications")]);
  const dmg = join(out, `${name("")}.dmg`);
  rmSync(dmg, { force: true });
  const hdiutil = (format) =>
    execFileSync("hdiutil", [
      "create",
      "-quiet",
      "-volname",
      "3D Maker Suite",
      "-srcfolder",
      dmgDir,
      "-format",
      format,
      dmg,
    ]);
  try {
    hdiutil("ULMO");
  } catch {
    hdiutil("UDZO");
  }
  outputs.push(dmg);
} else {
  cpSync(join(here, "install.sh"), join(stage, "install.sh"));
  const tgz = join(out, `${name("")}.tar.gz`);
  execFileSync("tar", ["-czf", tgz, "-C", work, "3d-maker-suite"]);
  outputs.push(tgz);
}
for (const f of outputs) console.log(`${f}: ${Math.round(statSync(f).size / 1e5) / 10} MB`);

/**
 * node.exe with the PE subsystem set from CONSOLE (3) to WINDOWS (2), so starting it opens no console
 * window. The patch breaks Node's Authenticode signature, so the certificate table goes too: a plainly
 * unsigned file instead of a broken signed one.
 */
function nodew(exe) {
  const pe = exe.readUInt32LE(0x3c);
  if (exe.toString("latin1", pe, pe + 4) !== "PE\0\0") throw new Error("not a PE file");
  const opt = pe + 24; // PE signature (4) + COFF header (20)
  if (exe.readUInt16LE(opt) !== 0x20b) throw new Error("not PE32+");
  if (exe.readUInt16LE(opt + 68) !== 3) throw new Error("not a console exe");
  exe.writeUInt16LE(2, opt + 68);
  const sec = opt + 112 + 4 * 8; // data directory 4: the certificate table
  const certAt = exe.readUInt32LE(sec);
  exe.writeBigUInt64LE(0n, sec);
  return certAt ? exe.subarray(0, certAt) : exe;
}

function infoPlist() {
  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>CFBundleExecutable</key><string>3d-maker-suite</string>
  <key>CFBundleIdentifier</key><string>io.github.emanuelmoniz.3d-maker-suite</string>
  <key>CFBundleName</key><string>3D Maker Suite</string>
  <key>CFBundlePackageType</key><string>APPL</string>
  <key>CFBundleShortVersionString</key><string>${version.split("-")[0]}</string>
  <key>CFBundleVersion</key><string>${version}</string>
  <key>LSMinimumSystemVersion</key><string>12.0</string>
  <key>LSUIElement</key><true/>
</dict></plist>
`;
}
