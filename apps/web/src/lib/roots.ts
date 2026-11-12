import { ROOT_HUB, type Root, type RootInput, type RootPatch } from "@3d-maker-suite/core";
import { queryOptions, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ApiError, api } from "./api.ts";

export const rootsQuery = queryOptions({
  queryKey: ["roots"],
  queryFn: () => api<Root[]>("GET", "/api/roots"),
});

const NONE: Root[] = [];
/** The project roots, in order (none while loading). */
export const useRoots = () => useQuery(rootsQuery).data ?? NONE;

type Change = { add: RootInput } | { id: string; patch: RootPatch } | { remove: string };

/** Adds, changes or removes a root (an add or change answers with it); the list is read again. */
export function useChangeRoot() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (c: Change) =>
      "add" in c
        ? api<Root>("POST", "/api/roots", c.add)
        : "remove" in c
          ? api<null>("DELETE", `/api/roots/${c.remove}`)
          : api<Root>("PATCH", `/api/roots/${c.id}`, c.patch),
    onSettled: () => qc.invalidateQueries({ queryKey: rootsQuery.queryKey }),
  });
}

const ROOT_ERRORS = {
  root_in_use: "settings:projects.rootInUse",
  root_exists: "settings:projects.rootExists",
  root_nested: "settings:projects.rootNested",
  path_denied: "settings:projects.rootNotShared",
  device_offline: "settings:projects.deviceOffline",
  device_timeout: "settings:projects.deviceTimeout",
} as const;

/** Why adding or changing a root at `location` failed, as a translation key. */
export function rootErrorKey(error: unknown, location: string) {
  const code = error instanceof ApiError ? error.code : undefined;
  if (code === "invalid_folder")
    return location !== ROOT_HUB
      ? "settings:projects.rootMissingDevice"
      : "settings:projects.rootMissing";
  return code && code in ROOT_ERRORS
    ? ROOT_ERRORS[code as keyof typeof ROOT_ERRORS]
    : "settings:saveError";
}
