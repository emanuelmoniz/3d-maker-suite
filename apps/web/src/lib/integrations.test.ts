import type { Integration } from "@3d-maker-suite/core";
import { expect, test } from "vitest";
import { syncTargets } from "./integrations.ts";

const row = (
  id: string,
  over: Partial<Integration> & { auto?: string[]; manual?: string[] },
): Integration =>
  ({
    id,
    enabled: true,
    capabilities: [...(over.auto ?? []), ...(over.manual ?? [])],
    policies: [
      ...(over.auto ?? []).map((type) => ({ type, mode: "auto" })),
      ...(over.manual ?? []).map((type) => ({ type, mode: "manual" })),
    ],
    ...over,
  }) as unknown as Integration;

const all = () => true;

test("only Auto sources of the asked types are targets", () => {
  const list = [
    row("a", { auto: ["printers"], manual: ["spools"] }),
    row("b", { manual: ["printers"] }),
    row("c", { auto: ["spools", "printers"] }),
  ];
  expect(syncTargets(list, ["printers"], all)).toEqual([
    { integrationId: "a", type: "printers" },
    { integrationId: "c", type: "printers" },
  ]);
  expect(syncTargets(list, ["spools"], all)).toEqual([{ integrationId: "c", type: "spools" }]);
});

test("a switched-off or not set up source is left out", () => {
  const off = row("a", { auto: ["printers"], enabled: false });
  const unset = row("b", { auto: ["printers"], capabilities: [] });
  expect(syncTargets([off, unset], ["printers"], all)).toEqual([]);
});

test("a type the caller may not sync is left out, per source", () => {
  const list = [row("a", { auto: ["brands"] }), row("b", { auto: ["brands"] })];
  const may = (id: string) => id === "b";
  expect(syncTargets(list, ["brands"], may)).toEqual([{ integrationId: "b", type: "brands" }]);
});

test("several types give one target per source and type", () => {
  const list = [row("a", { auto: ["brands", "printerModels"], manual: ["machinePresets"] })];
  expect(syncTargets(list, ["brands", "printerModels", "machinePresets"], all)).toEqual([
    { integrationId: "a", type: "brands" },
    { integrationId: "a", type: "printerModels" },
  ]);
});
