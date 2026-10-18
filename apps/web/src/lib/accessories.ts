import type {
  Accessory,
  AccessoryInput,
  AccessoryInstall,
  AccessoryPatch,
  InstallInput,
  Page,
} from "@3d-maker-suite/core";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { TFunction } from "i18next";
import { api } from "./api.ts";

// ponytail: one page of 100, the printer page's pickers; page them if anyone owns more.
export const useAccessories = (printerId?: string) =>
  useQuery({
    queryKey: ["accessories", "list", printerId ?? "all"],
    queryFn: () =>
      api<Page<Accessory>>(
        "GET",
        `/api/accessories?pageSize=100${printerId ? `&printerId=${printerId}` : ""}`,
      ),
  });

export const useAccessory = (id: string) =>
  useQuery({
    queryKey: ["accessories", id],
    queryFn: () => api<Accessory>("GET", `/api/accessories/${id}`),
  });

export const useAccessoryTypes = () =>
  useQuery({
    queryKey: ["accessories", "types"],
    queryFn: () => api<string[]>("GET", "/api/accessories/types"),
  });

export const useInstalls = (id: string) =>
  useQuery({
    queryKey: ["accessories", id, "installs"],
    queryFn: () => api<AccessoryInstall[]>("GET", `/api/accessories/${id}/installs`),
  });

/** Runs a mutation, then refreshes everything accessory-related. */
function useInvalidating<V, R = unknown>(fn: (v: V) => Promise<R>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["accessories"] }),
  });
}

export const useCreateAccessory = () =>
  useInvalidating((v: AccessoryInput) => api<Accessory>("POST", "/api/accessories", v));

export const usePatchAccessory = (id: string) =>
  useInvalidating((v: AccessoryPatch) => api<Accessory>("PATCH", `/api/accessories/${id}`, v));

export const useInstall = () =>
  useInvalidating((v: InstallInput & { accessoryId: string }) =>
    api("POST", `/api/accessories/${v.accessoryId}/installs`, {
      printerId: v.printerId,
      installedAt: v.installedAt,
    }),
  );

/** Takes the accessory off its printer: closes the open install. */
export const useRemoveInstall = () =>
  useInvalidating((v: { accessoryId: string; installId: string; removedAt: string }) =>
    api("PATCH", `/api/accessories/${v.accessoryId}/installs/${v.installId}`, {
      removedAt: v.removedAt,
    }),
  );

export const useDeleteInstall = (accessoryId: string) =>
  useInvalidating((installId: string) =>
    api("DELETE", `/api/accessories/${accessoryId}/installs/${installId}`),
  );

/** The name an accessory goes by everywhere: "01-AMS". The server builds the same in `accessoryLabel`. */
export const accessoryName = (t: TFunction, a: Pick<Accessory, "number" | "name">) =>
  t("common:accessoryName", { number: String(a.number).padStart(2, "0"), name: a.name });
