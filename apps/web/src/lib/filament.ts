import type {
  FilamentProfile,
  FilamentProfileInput,
  FilamentProfilePatch,
  LibraryImport,
  LibraryPreview,
  LibrarySource,
  LibrarySpoolImport,
  LibrarySpoolPreview,
  Page,
  Spool,
  SpoolAdjust,
  SpoolInput,
  SpoolPatch,
  SpoolWeightEntry,
} from "@3d-maker-suite/core";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "./api.ts";

// ponytail: one page of 100 rows each, add pagination controls if anyone owns more.
export const useProfiles = () =>
  useQuery({
    queryKey: ["filament", "profiles"],
    queryFn: () => api<Page<FilamentProfile>>("GET", "/api/filament/profiles?pageSize=100"),
  });

export const useSpools = (tagId = "") =>
  useQuery({
    queryKey: ["filament", "spools", tagId],
    queryFn: () =>
      api<Page<Spool>>("GET", `/api/filament/spools?pageSize=100${tagId ? `&tagId=${tagId}` : ""}`),
  });

export const useProfile = (id: string | undefined) =>
  useQuery({
    queryKey: ["filament", "profile", id],
    queryFn: () => api<FilamentProfile>("GET", `/api/filament/profiles/${id}`),
    enabled: !!id,
  });

export const useSpool = (id: string) =>
  useQuery({
    queryKey: ["filament", "spool", id],
    queryFn: () => api<Spool>("GET", `/api/filament/spools/${id}`),
  });

export const useSpoolHistory = (id: string | undefined) =>
  useQuery({
    queryKey: ["filament", "history", id],
    queryFn: () => api<SpoolWeightEntry[]>("GET", `/api/filament/spools/${id}/history`),
    enabled: !!id,
  });

/** Runs a mutation, then refreshes all filament data. */
function useInvalidating<V>(fn: (v: V) => Promise<unknown>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["filament"] }),
  });
}

export const useCreateProfile = () =>
  useInvalidating((v: FilamentProfileInput) => api("POST", "/api/filament/profiles", v));

export const usePatchProfile = () =>
  useInvalidating((v: { id: string; patch: FilamentProfilePatch }) =>
    api("PATCH", `/api/filament/profiles/${v.id}`, v.patch),
  );

export const useCreateSpool = () =>
  useInvalidating((v: SpoolInput) => api("POST", "/api/filament/spools", v));

export const usePatchSpool = () =>
  useInvalidating((v: { id: string; patch: SpoolPatch }) =>
    api("PATCH", `/api/filament/spools/${v.id}`, v.patch),
  );

export const useAdjustSpool = () =>
  useInvalidating((v: { id: string } & SpoolAdjust) =>
    api("POST", `/api/filament/spools/${v.id}/adjust`, {
      kind: v.kind,
      remainingGrams: v.remainingGrams,
      note: v.note,
    }),
  );

export const filamentLabel = (p?: FilamentProfile) =>
  p ? [p.brand, p.material, p.name].filter(Boolean).join(" ") : "";

export const useLibrarySources = () =>
  useQuery({
    queryKey: ["library", "sources"],
    queryFn: () => api<LibrarySource[]>("GET", "/api/filament/library"),
  });

export const useLibraryPreview = (id: string | undefined, includeSystem: boolean) =>
  useQuery({
    queryKey: ["library", id, includeSystem],
    queryFn: () =>
      api<LibraryPreview>(
        "GET",
        `/api/filament/library/${id}/preview?includeSystem=${includeSystem}`,
      ),
    enabled: !!id,
    retry: false,
    gcTime: 0, // always re-read the folder when the page opens
  });

export const useLibraryImport = (id: string) =>
  useInvalidating((v: LibraryImport) =>
    api<{ created: number }>("POST", `/api/filament/library/${id}/import`, v),
  );

export const useLibrarySpools = (id: string | undefined) =>
  useQuery({
    queryKey: ["library", id, "spools"],
    queryFn: () => api<LibrarySpoolPreview>("GET", `/api/filament/library/${id}/spools`),
    enabled: !!id,
    retry: false,
    gcTime: 0, // always re-read the inventory when the page opens
  });

export const useLibrarySpoolImport = (id: string) =>
  useInvalidating((v: LibrarySpoolImport) =>
    api<{ created: number }>("POST", `/api/filament/library/${id}/spools/import`, v),
  );
