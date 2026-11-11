import type {
  LibrarySources,
  PresetDevice,
  SlicerPreset,
  SlicerPresetDetail,
} from "@3d-maker-suite/core";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "./api.ts";

const KEY = ["presets"];

/** The hub's live slicer presets (ADR-0017), without their json. */
export const usePresets = () =>
  useQuery({ queryKey: KEY, queryFn: () => api<SlicerPreset[]>("GET", "/api/presets") });

/** One preset with its earlier versions; only fetched while `enabled` (its row is open). */
export const usePresetDetail = (id: string, enabled: boolean) =>
  useQuery({
    queryKey: [...KEY, id],
    queryFn: () => api<SlicerPresetDetail>("GET", `/api/presets/${id}`),
    enabled,
  });

/** The json as stored; `version` = an earlier one. A plain link: the session cookie goes with it. */
export const presetDownloadUrl = (id: string, version?: number) =>
  `/api/presets/${id}/download${version === undefined ? "" : `?version=${version}`}`;

/** Catalog settings → Sources and Preset sources: each slicer library's routes, catalog source and machines. */
export const useCatalogSources = (enabled = true) =>
  useQuery({
    queryKey: ["catalog-sources"],
    queryFn: () => api<LibrarySources[]>("GET", "/api/catalog/sources"),
    enabled,
    // Receive catalog's lines follow what the machines report.
    refetchInterval: 30_000,
  });

/** Devices with a slicer, their switches and kinds per slicer and install status; `enabled`: presets write. */
export const usePresetDevices = (enabled: boolean) =>
  useQuery({
    queryKey: [...KEY, "devices"],
    queryFn: () => api<PresetDevice[]>("GET", "/api/presets/devices"),
    enabled,
    refetchInterval: 30_000,
  });

export function useDeletePreset() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api("DELETE", `/api/presets/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}

/** Deleted presets, for Restore (ADR-0019); only fetched while `enabled` (catalog write). */
export const useDeletedPresets = (enabled: boolean) =>
  useQuery({
    queryKey: [...KEY, "deleted"],
    queryFn: () => api<SlicerPreset[]>("GET", "/api/presets/deleted"),
    enabled,
  });

/** A deleted preset's last content, or an earlier version, becomes its next version. */
export function useRestorePreset() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, version }: { id: string; version?: number }) =>
      api<SlicerPreset>("POST", `/api/presets/${id}/restore`, { version }),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}

/** A device's held removals go ahead, or the presets stay and Install writes them back there. */
export function useResolveHeld() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ device, action }: { device: string; action: "delete" | "keep" }) =>
      api("POST", `/api/presets/devices/${device}/held`, { action }),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}
