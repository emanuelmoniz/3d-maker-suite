// 6.3.0 Step 1 spike S6: a recursive watch with the connector's options (roots.ts), printing every
// event as "EVENT <ms epoch> <type> <path>", and "WATCH-ERROR"/"WATCH-CLOSE" if the watcher dies.
import { watch } from "node:fs";

const dir = process.argv[2];
const w = watch(dir, { recursive: true }, (type, f) => {
  if (!f || f.split(/[\\/]/).some((p) => p.startsWith(".")) || f.endsWith(".tmp")) return;
  console.log(`EVENT ${Date.now()} ${type} ${f}`);
});
w.on("error", (e) => console.log(`WATCH-ERROR ${Date.now()} ${e.code ?? e.message}`));
w.on("close", () => console.log(`WATCH-CLOSE ${Date.now()}`));
console.log(`WATCHING ${dir}`);
