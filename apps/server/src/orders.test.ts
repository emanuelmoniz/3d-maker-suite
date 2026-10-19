import { openDb } from "@3d-maker-suite/db";
import { beforeEach, describe, expect, it } from "vitest";
import { buildApp } from "./app.ts";
import { modelIdFor } from "./lib/catalog.ts";

let db: ReturnType<typeof openDb>;
let app: Awaited<ReturnType<typeof buildApp>>;
beforeEach(async () => {
  db = openDb(":memory:");
  app = await buildApp(db, false, ".");
});

const send = (method: "GET" | "POST" | "PATCH" | "DELETE", url: string, payload?: object) =>
  app.inject({ method, url, payload });

async function setup() {
  const project = async (name: string) => (await send("POST", "/api/projects", { name })).json();
  const lamp = await project("Lamp");
  const vase = await project("Vase");
  const printer = (
    await send("POST", "/api/printers", {
      name: "P1S",
      modelId: modelIdFor(db, "Bambu Lab", "P1S"),
      powerW: 1000,
    })
  ).json();
  const print = async (projectId: string, orderId?: string) =>
    (
      await send("POST", "/api/prints", {
        printerId: printer.id,
        projectId,
        orderId,
        title: "Part",
        startedAt: "2026-01-01T10:00:00.000Z",
        durationSec: 3600,
        outcome: "success",
      })
    ).json();
  return { lamp, vase, print };
}

describe("orders", () => {
  it("create, edit and move through the statuses; needs a project", async () => {
    const { lamp } = await setup();
    const o = (await send("POST", "/api/orders", { projectIds: [lamp.id], price: 5000 })).json();
    expect(o).toMatchObject({ number: 1, status: "accepted", clientId: null, printCount: 0 });
    expect(o.projectIds).toEqual([lamp.id]);
    for (const status of ["in_progress", "done", "canceled"])
      expect((await send("PATCH", `/api/orders/${o.id}`, { status })).json().status).toBe(status);
    const bad = await send("PATCH", `/api/orders/${o.id}`, { status: "lost" });
    expect(bad.json().error.code).toBe("invalid_status");
    expect((await send("POST", "/api/orders", { projectIds: [], price: 1 })).statusCode).toBe(400);
    expect((await send("PATCH", `/api/orders/${o.id}`, { projectIds: [] })).statusCode).toBe(400);
    expect((await send("GET", `/api/orders?projectId=${lamp.id}`)).json().total).toBe(1);
  });

  it("linking a print of another project adds that project; one in use can't be dropped", async () => {
    const { lamp, vase, print } = await setup();
    const o = (await send("POST", "/api/orders", { projectIds: [lamp.id], price: 5000 })).json();
    const p = await print(vase.id, o.id);
    expect(p.orderId).toBe(o.id);
    const got = (await send("GET", `/api/orders/${o.id}`)).json();
    expect(new Set(got.projectIds)).toEqual(new Set([lamp.id, vase.id]));
    expect(got.printCount).toBe(1);
    expect(got.printsCost).toBe(p.cost.total);
    expect(got.printsCost).toBeGreaterThan(0);

    const drop = await send("PATCH", `/api/orders/${o.id}`, { projectIds: [lamp.id] });
    expect([drop.statusCode, drop.json().error.code]).toEqual([409, "order_project_in_use"]);
    await send("PATCH", `/api/prints/${p.id}`, { orderId: null });
    expect((await send("PATCH", `/api/orders/${o.id}`, { projectIds: [lamp.id] })).statusCode).toBe(
      200,
    );

    const noProject = await send("PATCH", `/api/prints/${p.id}`, {
      projectId: null,
      orderId: o.id,
    });
    expect(noProject.json().error.code).toBe("print_project_required");
  });

  it("deleting an order keeps its prints, without the order", async () => {
    const { lamp, print } = await setup();
    const o = (await send("POST", "/api/orders", { projectIds: [lamp.id], price: 0 })).json();
    const p = await print(lamp.id, o.id);
    expect((await send("DELETE", `/api/orders/${o.id}`)).statusCode).toBe(204);
    expect((await send("GET", `/api/prints/${p.id}`)).json().orderId).toBeNull();
  });
});
