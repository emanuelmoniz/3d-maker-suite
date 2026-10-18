import type {
  MaintenanceDueItem,
  MaintenanceLog,
  MaintenanceType,
  MaintenanceTypeInput,
  MaintenanceTypePatch,
} from "@3d-maker-suite/core";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { accessoryName, useAccessories } from "./accessories.ts";
import { api } from "./api.ts";
import { useModelInfo } from "./catalog.ts";
import { printerName, usePrinters } from "./printers.ts";

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

/** "P1S, 01-X1C" / "AMS, 02-Hotend": what a type applies to, or "All printers/accessories". */
export function useAppliesTo() {
  const { t } = useTranslation();
  const printers = usePrinters({ archived: false }).data?.items ?? [];
  const accessories = useAccessories().data?.items ?? [];
  const models = useModelInfo();
  return (m: MaintenanceType) =>
    (m.target === "printer"
      ? [
          ...m.appliesToModelIds.map((id) => models.get(id)?.label ?? ""),
          ...printers
            .filter((p) => m.appliesToPrinterIds.includes(p.id))
            .map((p) => printerName(t, p)),
        ]
      : [
          ...m.appliesToAccessoryTypes,
          ...accessories
            .filter((a) => m.appliesToAccessoryIds.includes(a.id))
            .map((a) => accessoryName(t, a)),
        ]
    )
      .filter(Boolean)
      .join(", ") ||
    t(m.target === "printer" ? "maintenance:types.allModels" : "maintenance:types.allAccessories");
}
