import type {
  ConnectorSettings,
  ConnectorSettingsPatch,
  ConnectorSettingsResult,
  Device,
  DeviceLibraryUpdate,
  DeviceSyncMode,
  HubVersionsUsage,
  PairingCode,
} from "@3d-maker-suite/core";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "./api.ts";

const KEY = ["hub", "devices"];

// Every 30 s, so online and last seen stay fresh while the page is open.
export const useDevices = (enabled = true) =>
  useQuery({
    queryKey: KEY,
    queryFn: () => api<Device[]>("GET", "/api/hub/devices"),
    refetchInterval: 30_000,
    enabled,
  });

/** A connector's settings, read live from it: fails with 409 `device_offline` when it's offline. */
export const useConnectorSettings = (id: string, online: boolean) =>
  useQuery({
    queryKey: ["hub", "settings", id],
    queryFn: () => api<ConnectorSettings>("GET", `/api/hub/devices/${id}/settings`),
    enabled: online,
    retry: false,
  });

export function useConnectorActions(id: string) {
  const qc = useQueryClient();
  return {
    save: useMutation({
      mutationFn: (patch: ConnectorSettingsPatch) =>
        api<ConnectorSettingsResult>("PUT", `/api/hub/devices/${id}/settings`, patch),
      onSuccess: () => qc.invalidateQueries({ queryKey: ["hub", "settings", id] }),
    }),
    restart: useMutation({
      mutationFn: () => api("POST", `/api/hub/devices/${id}/restart`),
      // It drops offline and comes back: look more often for a while.
      onSuccess: () => {
        for (const ms of [2_000, 6_000, 12_000, 20_000])
          setTimeout(() => qc.invalidateQueries({ queryKey: KEY }), ms);
      },
    }),
    stop: useMutation({
      mutationFn: () => api("POST", `/api/hub/devices/${id}/stop`),
      onSuccess: () => setTimeout(() => qc.invalidateQueries({ queryKey: KEY }), 2_000),
    }),
  };
}

/** Disk used by the kept file versions. */
export const useVersionsUsage = () =>
  useQuery({
    queryKey: ["hub", "versions"],
    queryFn: () => api<HubVersionsUsage>("GET", "/api/hub/versions"),
  });

export function useDeviceActions() {
  const qc = useQueryClient();
  const refresh = () => qc.invalidateQueries({ queryKey: KEY });
  return {
    pairingCode: useMutation({
      mutationFn: (userId: string) =>
        api<PairingCode>("POST", "/api/hub/pairing-codes", { userId }),
    }),
    userCode: useMutation({
      mutationFn: ({ id, userId }: { id: string; userId: string }) =>
        api<PairingCode>("POST", `/api/hub/devices/${id}/user-code`, { userId }),
    }),
    rename: useMutation({
      mutationFn: ({ id, name }: { id: string; name: string }) =>
        api("PATCH", `/api/hub/devices/${id}`, { name }),
      onSuccess: refresh,
    }),
    syncMode: useMutation({
      mutationFn: ({ id, syncMode }: { id: string; syncMode: DeviceSyncMode }) =>
        api("PATCH", `/api/hub/devices/${id}`, { syncMode }),
      onSuccess: refresh,
    }),
    /** Receive from the hub and Share to the hub (ADR-0021). */
    projects: useMutation({
      mutationFn: ({
        id,
        ...patch
      }: {
        id: string;
        receiveProjects?: boolean;
        shareProjects?: boolean;
      }) => api("PATCH", `/api/hub/devices/${id}`, patch),
      onSuccess: refresh,
    }),
    /** A slicer's switches on the machine page: Use as slicer, Catalog, Presets. */
    library: useMutation({
      mutationFn: ({
        id,
        library,
        ...patch
      }: DeviceLibraryUpdate & { id: string; library: string }) =>
        api("PATCH", `/api/hub/devices/${id}/slicers/${encodeURIComponent(library)}`, patch),
      onSuccess: refresh,
    }),
    unselect: useMutation({
      mutationFn: ({ id, projectId }: { id: string; projectId: string }) =>
        api("DELETE", `/api/hub/devices/${id}/projects/${projectId}`),
      onSuccess: refresh,
    }),
    update: useMutation({
      mutationFn: (id: string) => api("POST", `/api/hub/devices/${id}/update`),
      onSuccess: refresh,
    }),
    revoke: useMutation({
      mutationFn: (id: string) => api("DELETE", `/api/hub/devices/${id}`),
      onSuccess: refresh,
    }),
  };
}
