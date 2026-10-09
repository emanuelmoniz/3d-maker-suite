import type {
  MaintenanceDueItem,
  MaintenanceLog,
  MaintenanceType,
  MaintenanceTypeInput,
  MaintenanceTypePatch,
} from "@3d-maker-suite/core";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "./api.ts";

export const useDue = () =>
  useQuery({
    queryKey: ["maintenance", "due"],
    queryFn: () => api<MaintenanceDueItem[]>("GET", "/api/maintenance/due"),
  });

export const useMaintenanceType = (id: string) =>
  useQuery({
    queryKey: ["maintenance", "type", id],
    queryFn: () => api<MaintenanceType>("GET", `/api/maintenance/types/${id}`),
  });

/** Runs a mutation, then refreshes all maintenance data. */
function useInvalidating<V>(fn: (v: V) => Promise<unknown>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["maintenance"] }),
  });
}

export const useCreateType = () =>
  useInvalidating((v: MaintenanceTypeInput) => api("POST", "/api/maintenance/types", v));

export const usePatchType = () =>
  useInvalidating((v: { id: string; patch: MaintenanceTypePatch }) =>
    api("PATCH", `/api/maintenance/types/${v.id}`, v.patch),
  );

export const useLogDone = () =>
  useInvalidating((v: MaintenanceLog) => api("POST", "/api/maintenance/tasks", v));
