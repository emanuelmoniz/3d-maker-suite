// Fails when the release version is out of sync: every package.json with a version, the README
// status line and the newest CHANGELOG entry must all match. On a tag push the tag must be v<version>.
// Run by `pnpm version:check` and by the release workflow before anything is built.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const read = (f) => readFileSync(f, "utf8");
const subdirs = (d) =>
  existsSync(d) ? readdirSync(d, { withFileTypes: true }).filter((e) => e.isDirectory()) : [];
const manifests = [
  "package.json",
  ...subdirs("apps").map((e) => join("apps", e.name, "package.json")),
  ...subdirs("packages").map((e) => join("packages", e.name, "package.json")),
  ...subdirs("packages/adapters").map((e) => join("packages/adapters", e.name, "package.json")),
].filter((f) => existsSync(f) && JSON.parse(read(f)).version !== undefined);

const version = JSON.parse(read("package.json")).version;
const errors = [];

for (const f of manifests) {
  const v = JSON.parse(read(f)).version;
  if (v !== version) errors.push(`${f} is ${v}, root is ${version}`);
}

const readme = read("README.md").match(/^Version (\S+)\./m)?.[1];
if (readme !== version)
  errors.push(`README.md status says ${readme ?? "nothing"}, expected ${version}`);

const changelog = read("CHANGELOG.md").match(/^## \[([^\]]+)\]/m)?.[1];
if (changelog !== version)
  errors.push(`CHANGELOG.md newest entry is ${changelog}, expected ${version}`);

if (process.env.GITHUB_REF_TYPE === "tag" && process.env.GITHUB_REF_NAME !== `v${version}`)
  errors.push(`tag ${process.env.GITHUB_REF_NAME} does not match package version v${version}`);

if (errors.length) {
  console.error(`Version check failed:\n- ${errors.join("\n- ")}`);
  process.exit(1);
}
console.log(
  `Version ${version} is consistent in ${manifests.length} package.json files, README and CHANGELOG.`,
);
