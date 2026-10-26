import { configDefaults, defineConfig } from "vitest/config";

// The dev data dir sits in the repo; a managed slicer unpacked there ships its own *.test.js.
export default defineConfig({ test: { exclude: [...configDefaults.exclude, "data/**"] } });
