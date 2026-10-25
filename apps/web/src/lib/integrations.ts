import type {
  AdapterInfo,
  Capability,
  Integration,
  IntegrationInput,
  IntegrationPatch,
  LoginRequest,
  LoginResult,
  SyncRequest,
  SyncResult,
  SyncRun,
  TestResult,
} from "@3d-maker-suite/core";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { api } from "./api.ts";
import { useRole } from "./auth.ts";
import { useListPage } from "./list.ts";

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

/** Integrations that can do `cap` right now. The server decides; the UI never checks vendors. */
export const useCapable = (cap: Capability) =>
  (useIntegrations().data ?? []).filter((i) => i.capabilities.includes(cap));

/**
 * What the caller may do with one task (ADR-0012): an admin everything, an editor what the task's
 * flags allow, a viewer nothing. `any`: sync or review. The server checks the same.
 */
export function useMayTask() {
  const role = useRole();
  // Only an editor's answer depends on the flags.
  const list = useIntegrations(role === "editor").data;
  return (integrationId: string, type: string, what: "sync" | "review" | "any") => {
    if (role === "admin") return true;
    if (role !== "editor") return false;
    const p = list?.find((i) => i.id === integrationId)?.policies.find((x) => x.type === type);
    return (
      !!p &&
      (what === "sync"
        ? p.editorSync
        : what === "review"
          ? p.editorReview
          : p.editorSync || p.editorReview)
    );
  };
}

/** The Integrations page has something for the caller: an admin, or an editor with a task. */
export function useHasTasks() {
  const role = useRole();
  const list = useIntegrations(role === "editor").data ?? [];
  return (
    role === "admin" ||
    (role === "editor" && list.some((i) => i.policies.some((p) => p.editorSync || p.editorReview)))
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

export const useCreateIntegration = () =>
  useInvalidating((v: IntegrationInput) => api<Integration>("POST", "/api/integrations", v));

export const usePatchIntegration = (id: string) =>
  useInvalidating((v: IntegrationPatch) => api<Integration>("PATCH", `/api/integrations/${id}`, v));

export const useDeleteIntegration = (id: string) =>
  useInvalidating(() => api("DELETE", `/api/integrations/${id}`));

export const useTestIntegration = (id: string) =>
  useMutation({
    mutationFn: () => api<TestResult>("POST", `/api/integrations/${id}/test`),
  });

export const useSyncIntegration = (id: string) =>
  useInvalidating(
    (req: SyncRequest) => api<SyncResult>("POST", `/api/integrations/${id}/sync`, req),
    true,
  );

/** On success the server starts a sync, which can import printers. */
export const useLogin = (id: string) =>
  useInvalidating(
    (v: LoginRequest) => api<LoginResult>("POST", `/api/integrations/${id}/login`, v),
    true,
  );
