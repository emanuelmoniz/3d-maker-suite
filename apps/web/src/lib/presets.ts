import type {
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

/** Devices with a slicer, their two switches and install status; `enabled`: presets.manage. */
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
