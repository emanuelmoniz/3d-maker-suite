import type { Root, RootInput, RootPatch } from "@3d-maker-suite/core";
import { queryOptions, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "./api.ts";

export const rootsQuery = queryOptions({
  queryKey: ["roots"],
  queryFn: () => api<Root[]>("GET", "/api/roots"),
});

const NONE: Root[] = [];
/** The project roots, in order (none while loading). */
export const useRoots = () => useQuery(rootsQuery).data ?? NONE;

type Change = { add: RootInput } | { id: string; patch: RootPatch } | { remove: string };

/** Adds, changes or removes a root; the list is read again either way. */
export function useChangeRoot() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (c: Change) =>
      "add" in c
        ? api("POST", "/api/roots", c.add)
        : "remove" in c
          ? api("DELETE", `/api/roots/${c.remove}`)
          : api("PATCH", `/api/roots/${c.id}`, c.patch),
    onSettled: () => qc.invalidateQueries({ queryKey: rootsQuery.queryKey }),
  });
}
