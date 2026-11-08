import type {
  CatalogSourcePick,
  LibrarySources,
  PresetDevice,
  PresetDeviceUpdate,
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

/** Catalog → Sources: each slicer library's routes and catalog source (ADR-0020). */
export const useCatalogSources = () =>
  useQuery({
    queryKey: ["catalog-sources"],
    queryFn: () => api<LibrarySources[]>("GET", "/api/catalog/sources"),
  });

/**
 * The device a library's catalog comes from, if one does: a slicer added on the hub takes over from
 * it (ADR-0020), which the install dialog and the add form say first.
 */
export function useDeviceCatalogSource(library: string | null | undefined) {
  const lib = useCatalogSources().data?.find((l) => l.library === library);
  const deviceId = lib?.source && "deviceId" in lib.source && lib.source.deviceId;
  const device = deviceId
    ? lib.options.find((o) => "deviceId" in o && o.deviceId === deviceId)
    : undefined;
  return device && "name" in device ? device.name : undefined;
}

/** Picks a library's catalog source; its Catalog and System presets cards turn on. */
export function usePickCatalogSource() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ library, pick }: { library: string; pick: CatalogSourcePick }) =>
      api("PUT", `/api/catalog/sources/${encodeURIComponent(library)}`, pick),
    onSuccess: () =>
      Promise.all([
        qc.invalidateQueries({ queryKey: ["catalog-sources"] }),
        qc.invalidateQueries({ queryKey: ["integrations"] }),
      ]),
  });
}

/** Devices with a slicer, their switches per slicer and install status; `enabled`: catalog write. */
export const usePresetDevices = (enabled: boolean) =>
  useQuery({
    queryKey: [...KEY, "devices"],
    queryFn: () => api<PresetDevice[]>("GET", "/api/presets/devices"),
    enabled,
    refetchInterval: 30_000,
  });

export function useUpdatePresetDevice() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: PresetDeviceUpdate & { id: string }) =>
      api("PATCH", `/api/presets/devices/${id}`, body),
    onSuccess: () => qc.invalidateQueries({ queryKey: KEY }),
  });
}

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
