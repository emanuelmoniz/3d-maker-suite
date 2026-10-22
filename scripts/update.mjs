// The launcher's half of an update or rollback (ADR-0009). The server backs up, fetches and
// writes .update/pending.json, then exits; this swaps the code while nothing holds node_modules.
// Node stdlib only: it runs from whatever version was checked out before.
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/** Exit code the server uses to ask the launcher for a restart. */
export const RESTART = 75;

/** git or pnpm in `cwd`, output to the terminal; throws when it fails. */
export function sh(cwd, cmd, args) {
  const pnpm = process.env.npm_execpath;
  // pnpm sets npm_execpath to its own JS (run it with this Node) or to its standalone binary.
  const [bin, argv] =
    cmd === "pnpm" && pnpm
      ? /\.[cm]?js$/.test(pnpm)
        ? [process.execPath, [pnpm, ...args]]
        : [pnpm, args]
      : [cmd, args];
  const r = spawnSync(bin, argv, {
    cwd,
    stdio: "inherit",
    shell: cmd === "pnpm" && !pnpm && process.platform === "win32",
  });
  if (r.status !== 0) throw new Error(`${cmd} ${args.join(" ")} failed`);
}

/** The Node major a checkout asks for in `engines.node` (">=22"), or 0. */
const nodeNeeded = (root) =>
  Number(
    />=\s*(\d+)/.exec(
      JSON.parse(readFileSync(join(root, "package.json"), "utf8")).engines?.node,
    )?.[1] ?? 0,
  );

/**
 * Applies .update/pending.json, if any: checks out its ref, installs and builds. On failure it
 * goes back to `from` (and drops a staged restore, so the current code never opens an old DB).
 * Writes .update/result.json for the server to pick up. Returns it; null = nothing pending.
 * Throws only when even going back failed: then nothing should start.
 */
export function applyPending(
  root,
  run = (cmd, args) => sh(root, cmd, args),
  nodeMajor = Number(process.versions.node.split(".")[0]),
) {
  const dir = join(root, ".update");
  const file = join(dir, "pending.json");
  if (!existsSync(file)) return null;
  const p = JSON.parse(readFileSync(file, "utf8"));
  rmSync(file);
  let needsNode;
  const swap = (ref, check) => {
    let step = "checkout";
    try {
      run("git", ["checkout", "--detach", ref]);
      if (check && nodeNeeded(root) > nodeMajor) {
        needsNode = nodeNeeded(root);
        return "node";
      }
      step = "install";
      run("pnpm", ["install", "--frozen-lockfile"]);
      step = "build";
      run("pnpm", ["--filter", "@3d-maker-suite/web", "build"]);
      return null;
    } catch {
      return step;
    }
  };
  const failedStep = swap(p.ref, true);
  const result = { ...p, ok: !failedStep, ...(failedStep && { failedStep, needsNode }) };
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "result.json"), JSON.stringify(result, null, 2));
  if (failedStep) {
    if (p.restoreDir) rmSync(p.restoreDir, { recursive: true, force: true });
    console.error(`\n${p.action} to ${p.toVersion} failed at "${failedStep}", going back.\n`);
    if (swap(p.from, false))
      throw new Error(
        `Could not go back either. In ${root}, run:\n  git checkout --detach ${p.from}\n  pnpm install --frozen-lockfile\n  pnpm start`,
      );
  }
  return result;
}
