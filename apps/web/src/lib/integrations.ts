import type {
  AdapterInfo,
  Integration,
  IntegrationInput,
  IntegrationPatch,
  LoginRequest,
  LoginResult,
  SyncRun,
  TestResult,
} from "@3d-maker-suite/core";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "./api.ts";

export const useAdapters = () =>
  useQuery({
    queryKey: ["integrations", "adapters"],
    queryFn: () => api<AdapterInfo[]>("GET", "/api/integrations/adapters"),
  });

export const useIntegrations = () =>
  useQuery({
    queryKey: ["integrations", "list"],
    queryFn: () => api<Integration[]>("GET", "/api/integrations"),
  });

export const useSyncRuns = (id: string, enabled: boolean) =>
  useQuery({
    queryKey: ["integrations", id, "runs"],
    queryFn: () => api<SyncRun[]>("GET", `/api/integrations/${id}/runs`),
    enabled,
  });

/** A sync can import printers and prints, so everything is refreshed afterwards. */
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
  useInvalidating(() => api<SyncRun>("POST", `/api/integrations/${id}/sync`), true);

/** On success the server starts a sync, which can import printers. */
export const useLogin = (id: string) =>
  useInvalidating(
    (v: LoginRequest) => api<LoginResult>("POST", `/api/integrations/${id}/login`, v),
    true,
  );
