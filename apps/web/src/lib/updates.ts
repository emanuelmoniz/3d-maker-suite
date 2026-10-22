import type { UpdatesResponse } from "@3d-maker-suite/core";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { api } from "./api.ts";

const KEY = ["updates"];

export const useUpdates = () =>
  useQuery({ queryKey: KEY, queryFn: () => api<UpdatesResponse>("GET", "/api/updates") });

export function useCheckUpdates() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api<UpdatesResponse>("POST", "/api/updates/check"),
    onSuccess: (v) => {
      qc.setQueryData(KEY, v);
      void qc.invalidateQueries({ queryKey: ["alerts"] });
    },
  });
}

const health = () =>
  fetch("/api/health").then(
    (r) => (r.ok ? (r.json() as Promise<{ version: string }>) : null),
    () => null,
  );

/**
 * Update or rollback: the server backs up and hands over, then goes away while the launcher
 * installs and builds (ADR-0009). Waits for it to go down and come back; a new version reloads
 * the page, the same one means it went back (the history says why).
 */
export function useRunUpdate() {
  const qc = useQueryClient();
  const [phase, setPhase] = useState<"idle" | "preparing" | "installing" | "back" | "slow">("idle");
  const run = useMutation({
    mutationFn: async (v: { tag: string } | { backup: string }) => {
      setPhase("preparing");
      const before = (await health())?.version;
      await api("POST", "tag" in v ? "/api/updates/apply" : "/api/updates/rollback", v);
      setPhase("installing");
      let down = false;
      // ponytail: 15 minutes, then the page stops waiting; the terminal shows the launcher.
      for (let i = 0; i < 450; i++) {
        await new Promise((r) => setTimeout(r, 2000));
        const up = await health();
        if (!up) down = true;
        else if (down || up.version !== before) {
          if (up.version !== before) return location.reload();
          await qc.invalidateQueries();
          return setPhase("back");
        }
      }
      setPhase("slow");
    },
    onError: () => setPhase("idle"),
  });
  return { ...run, phase };
}
