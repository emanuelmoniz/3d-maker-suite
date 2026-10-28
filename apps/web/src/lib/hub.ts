import type { Device, PairingCode } from "@3d-maker-suite/core";
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
