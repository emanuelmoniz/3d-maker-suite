import {
  type AdapterInfo,
  type Capability,
  type DeviceSlicerCheck,
  type ImportCatalogBrands,
  type ImportCatalogPick,
  type ImportResult,
  type Integration,
  type IntegrationInput,
  type IntegrationPatch,
  type LoginRequest,
  type LoginResult,
  pickSlicer,
  type SlicerCheck,
  type SlicerInstallStatus,
  type SlicerRelease,
  type SyncRequest,
  type SyncResult,
  type SyncRun,
  type TestResult,
} from "@3d-maker-suite/core";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { KINDS, LOCATIONS } from "../pages/settings/integrationLabels.ts";
import { api } from "./api.ts";
import { useRights } from "./auth.ts";
import { useListPage } from "./list.ts";
import { usePreferences } from "./preferences.ts";

export const useAdapters = () =>
  useQuery({
    queryKey: ["integrations", "adapters"],
    queryFn: () => api<AdapterInfo[]>("GET", "/api/integrations/adapters"),
  });

export const useIntegrations = (enabled = true) =>
  useQuery({
    queryKey: ["integrations", "list"],
    queryFn: () => api<Integration[]>("GET", "/api/integrations"),
    enabled,
  });

/**
 * What the UI calls an integration: its adapter's name. Vendor names live under
 * `integrations:adapters.<id>` so a new adapter only adds locale keys (load the namespace).
 */
export function useAdapterName() {
  const { t } = useTranslation();
  return (id: string) => t(`integrations:adapters.${id}.name`, { defaultValue: id });
}

/**
 * Name and kind ("Bambu Studio - Server"), or a worker's device ("Bambu Studio (WS-3)"), for
 * pickers where a slicer's kinds sit side by side.
 */
export function useIntegrationLabel() {
  const { t } = useTranslation();
  const adapterName = useAdapterName();
  return (i: Pick<Integration, "adapterId" | "kind" | "deviceName">) =>
    i.deviceName
      ? t("integrations:nameOnDevice", { name: adapterName(i.adapterId), device: i.deviceName })
      : t("integrations:nameWithKind", { name: adapterName(i.adapterId), kind: t(KINDS[i.kind]) });
}

/** The card an integration sits on: its slicer library (every place it runs), else its adapter. */
export const libraryOf = (i: Pick<Integration, "presetLibrary" | "adapterId">) =>
  i.presetLibrary ?? i.adapterId;

/** Where a slicer runs, on its card: this computer, this server, or the workstation's name. */
export function useLocationLabel() {
  const { t } = useTranslation();
  return (i: Pick<Integration, "kind" | "deviceName">) =>
    i.kind === "worker"
      ? (i.deviceName ?? t("integrations:locations.worker"))
      : t(LOCATIONS[i.kind]);
}

/** The data types an account feeds on their own Sources tab (ADR-0021). */
const ACCOUNT_TYPES = ["printers", "prints", "spools"] as const;
export type AccountType = (typeof ACCOUNT_TYPES)[number];
/** A task that lives on a Sources tab, not on the Integrations page. */
export const onSources = (i: Pick<Integration, "kind">, type: string) =>
  i.kind === "cloud" && (ACCOUNT_TYPES as readonly string[]).includes(type);

/** An enabled account that has `type` has its line on that type's Sources tab. */
export const feeds = (i: Integration, type: AccountType) =>
  i.kind === "cloud" && i.enabled && i.policies.some((p) => p.type === type);

/** Integrations that can do `cap` right now. The server decides; the UI never checks vendors. */
export const useCapable = (cap: Capability) =>
  (useIntegrations().data ?? []).filter((i) => i.capabilities.includes(cap));

/**
 * The slicer types that can slice now (ADR-0022: one hub's slicer each, the only rows with
 * `slice`), named by type, and what picks resolve to (as the server's `slicerResolver` does).
 */
export function useSlicers() {
  const all = useIntegrations().data ?? [];
  const slicers = all.filter((i) => i.capabilities.includes("slice"));
  const adapterName = useAdapterName();
  const defaultSlicerId = usePreferences().data?.values.defaultSlicerId;
  const ids = slicers.map((s) => s.id);
  // A pick names a slicer type: any install of it stands for its hub's slicer.
  const toHub = (id: string | null | undefined) => {
    const row = all.find((i) => i.id === id);
    return row && slicers.find((s) => s.id === row.id || libraryOf(s) === libraryOf(row))?.id;
  };
  const nameOf = (id: string | undefined) => {
    const s = slicers.find((x) => x.id === id);
    return s ? adapterName(libraryOf(s)) : "";
  };
  return {
    slicers: slicers.map((s) => ({ id: s.id, name: nameOf(s.id), library: s.presetLibrary })),
    /** A pick's slicer type that can slice now, else null: what the "inherited" option shows. */
    usable: (id: string | null | undefined) => toHub(id) ?? null,
    nameOf,
    /** Plate, project: the slicer it slices with (`pickSlicer` over the default slicer). */
    resolve: (picks: (string | null | undefined)[]) =>
      pickSlicer(ids, [...picks, defaultSlicerId].map(toHub)),
  };
}

/** The slicer type the default slicer is (`defaultSlicerId`'s library), else undefined. */
export function useDefaultLibrary() {
  const all = useIntegrations().data ?? [];
  const defaultSlicerId = usePreferences().data?.values.defaultSlicerId;
  const row = all.find((i) => i.id === defaultSlicerId);
  return row && libraryOf(row);
}

/** The caller's task permissions (ADR-0016); only the sync and review ones depend on the flags. */
function useTaskRights() {
  const p = useRights()?.permissions;
  const manage = !!p?.["integrations.manage"];
  const sync = !!p?.["integrations.sync"];
  const review = !!p?.["integrations.review"];
  const list = useIntegrations(!manage && (sync || review)).data ?? [];
  const allowed = (t: { editorSync: boolean; editorReview: boolean }) => ({
    sync: sync && t.editorSync,
    review: review && t.editorReview,
  });
  return { manage, list, allowed };
}

/**
 * What the caller may do with one task: everything with integrations.manage; else sync (review)
 * with that permission and the task's flag on. `any`: sync or review. The server checks the same.
 */
export function useMayTask() {
  const { manage, list, allowed } = useTaskRights();
  return (integrationId: string, type: string, what: "sync" | "review" | "any") => {
    if (manage) return true;
    const p = list.find((i) => i.id === integrationId)?.policies.find((x) => x.type === type);
    if (!p) return false;
    const a = allowed(p);
    return what === "any" ? a.sync || a.review : a[what];
  };
}

/**
 * The Integrations page has something for the caller: integrations.manage, or a task they may run
 * there (an account's printers, prints and spools are on their Sources tabs).
 */
export function useHasTasks() {
  const { manage, list, allowed } = useTaskRights();
  return (
    manage ||
    list.some((i) =>
      i.policies.some((p) => {
        if (onSources(i, p.type)) return false;
        const a = allowed(p);
        return a.sync || a.review;
      }),
    )
  );
}

export const useSyncRuns = (id: string, query: Record<string, string>) =>
  useListPage<SyncRun>(["integrations", id, "runs"], `/api/integrations/${id}/runs`, query);

/** A sync can import printers, prints, spools..., so everything is refreshed afterwards. */
function useInvalidating<V, R = unknown>(fn: (v: V) => Promise<R>, all = false) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSettled: () => qc.invalidateQueries(all ? undefined : { queryKey: ["integrations"] }),
  });
}

// Adding or removing a workstation also makes its device a slice worker or not: all of it.
export const useCreateIntegration = () =>
  useInvalidating((v: IntegrationInput) => api<Integration>("POST", "/api/integrations", v), true);

// Switching one off or on changes the hub's slicer's choices (catalog sources) too: all of it.
export const usePatchIntegration = (id: string) =>
  useInvalidating(
    (v: IntegrationPatch) => api<Integration>("PATCH", `/api/integrations/${id}`, v),
    true,
  );

export const useDeleteIntegration = (id: string) =>
  useInvalidating(() => api("DELETE", `/api/integrations/${id}`), true);

/**
 * Picks a slicer type's hub's slicer (ADR-0022): slicing, the catalog and every receiver follow,
 * so everything is refreshed.
 */
export const usePickHubSlicer = (library: string) =>
  useInvalidating(
    (integrationId: string) =>
      api("PUT", `/api/integrations/slicers/${encodeURIComponent(library)}`, { integrationId }),
    true,
  );

export const useTestIntegration = (id: string) =>
  useMutation({
    mutationFn: () => api<TestResult>("POST", `/api/integrations/${id}/test`),
  });

export const useSyncIntegration = (id: string) =>
  useInvalidating(
    (req: SyncRequest) => api<SyncResult>("POST", `/api/integrations/${id}/sync`, req),
    true,
  );

/** A slicer's printer and filament brands and whether you have them, for the Catalog row. */
export const useCatalogBrands = (id: string, enabled: boolean) =>
  useQuery({
    queryKey: ["integrations", id, "catalog"],
    queryFn: () => api<ImportCatalogBrands>("GET", `/api/import/catalog/${id}`),
    enabled,
  });

/** Adds the picked brands with their models and presets. */
export const useImportBrands = (id: string) =>
  useInvalidating(
    (pick: ImportCatalogPick) => api<ImportResult>("POST", `/api/import/catalog/${id}`, pick),
    true,
  );

/** A managed slicer's installable releases; the server asks GitHub at most once an hour. */
export const useSlicerReleases = (id: string, pre: boolean, enabled = true) =>
  useQuery({
    queryKey: ["integrations", id, "slicer", "releases", pre],
    queryFn: () =>
      api<SlicerRelease[]>("GET", `/api/integrations/${id}/slicer/releases?pre=${pre}`),
    enabled,
    staleTime: 60 * 60_000,
  });

/** The install job; polled while it runs, and the card refreshes once it ends. */
export function useSlicerInstall(id: string) {
  const qc = useQueryClient();
  return useQuery({
    queryKey: ["integrations", id, "slicer", "install"],
    queryFn: async () => {
      const s = await api<SlicerInstallStatus>("GET", `/api/integrations/${id}/slicer/install`);
      if (s.state !== "running") qc.invalidateQueries({ queryKey: ["integrations", "list"] });
      return s;
    },
    refetchInterval: (q) => (q.state.data?.state === "running" ? 1000 : false),
  });
}

export function useInstallSlicer(id: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (tag: string) =>
      api<SlicerInstallStatus>("POST", `/api/integrations/${id}/slicer/install`, { tag }),
    onSuccess: (s) => qc.setQueryData(["integrations", id, "slicer", "install"], s),
  });
}

/** A worker's installed slicer: found on its device (`slicer`) or a typed path, checked there. */
export const useCheckSlicer = (id: string) =>
  useInvalidating((v: SlicerCheck) =>
    api<DeviceSlicerCheck>("POST", `/api/integrations/${id}/slicer/check`, v),
  );

export const useRemoveSlicer = (id: string) =>
  useInvalidating(() => api("DELETE", `/api/integrations/${id}/slicer`));

/** On success the server starts a sync, which can import printers. */
export const useLogin = (id: string) =>
  useInvalidating(
    (v: LoginRequest) => api<LoginResult>("POST", `/api/integrations/${id}/login`, v),
    true,
  );
