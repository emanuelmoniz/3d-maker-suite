import type {
  ConnectorSettings,
  ConnectorSettingsPatch,
  ConnectorSettingsResult,
  Device,
  DeviceLibraryUpdate,
  HubVersionsUsage,
  PairingCode,
  Pick,
  PickLevel,
  SharedFolder,
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
    /** Use slicer as server worker, and the Slicers catalog Receive and Share switches. */
    slicers: useMutation({
      mutationFn: ({
        id,
        ...patch
      }: {
        id: string;
        useAsWorker?: boolean;
        receiveCatalog?: boolean;
        shareCatalog?: boolean;
      }) => api("PATCH", `/api/hub/devices/${id}`, patch),
      // Integrations and the Catalog and Presets Sources tabs list machines by them; worker off
      // removes its installs from Integrations.
      onSuccess: () =>
        Promise.all([
          refresh(),
          qc.invalidateQueries({ queryKey: ["integrations"] }),
          qc.invalidateQueries({ queryKey: ["presets", "devices"] }),
          qc.invalidateQueries({ queryKey: ["catalog-sources"] }),
        ]),
    }),
    /** A machine's shared folders (ADR-0021): add (POST), pause or resume (PATCH), remove. */
    folders: useMutation({
      mutationFn: ({
        id,
        method,
        ...body
      }: {
        id: string;
        method: "POST" | "PATCH" | "DELETE";
        path: string;
        paused?: boolean;
      }) => api<SharedFolder[]>(method, `/api/hub/devices/${id}/folders`, body),
      onSuccess: refresh,
    }),
    /** A machine's picks (ADR-0021): add (POST), pause or change who (PATCH), remove. */
    picks: useMutation({
      mutationFn: ({
        id,
        pickId,
        method,
        ...body
      }: {
        id: string;
        pickId?: string;
        method: "POST" | "PATCH" | "DELETE";
        rootId?: string;
        path?: string;
        paused?: boolean;
        level?: PickLevel;
      }) =>
        api<Pick[]>(
          method,
          `/api/hub/devices/${id}/picks${pickId ? `/${pickId}` : ""}`,
          method === "DELETE" ? undefined : body,
        ),
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
      // The Catalog and Presets Sources tabs list the same switches.
      onSuccess: () =>
        Promise.all([
          refresh(),
          qc.invalidateQueries({ queryKey: ["presets", "devices"] }),
          qc.invalidateQueries({ queryKey: ["catalog-sources"] }),
        ]),
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
