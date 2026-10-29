import type { Device, DeviceSyncMode, HubVersionsUsage, PairingCode } from "@3d-maker-suite/core";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "./api.ts";

const KEY = ["hub", "devices"];

// Every 30 s, so online and last seen stay fresh while the page is open.
export const useDevices = () =>
  useQuery({
    queryKey: KEY,
    queryFn: () => api<Device[]>("GET", "/api/hub/devices"),
    refetchInterval: 30_000,
  });

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
