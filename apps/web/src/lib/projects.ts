import type {
  Page,
  Project,
  ProjectInput,
  ProjectPatch,
  ProjectScanStatus,
} from "@3d-maker-suite/core";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "./api.ts";

// ponytail: one page of 100 projects, add pagination controls if libraries get bigger.
export const useProjects = () =>
  useQuery({
    queryKey: ["projects", "list"],
    queryFn: () => api<Page<Project>>("GET", "/api/projects?pageSize=100&sort=name"),
  });

export const useProject = (id: string) =>
  useQuery({
    queryKey: ["projects", id],
    queryFn: () => api<Project>("GET", `/api/projects/${id}`),
  });

export const projectThumbnailUrl = (p: Pick<Project, "id" | "updatedAt">) =>
  `/api/projects/${p.id}/thumbnail?v=${encodeURIComponent(p.updatedAt)}`;

export const useCreateProject = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: ProjectInput) => api<Project>("POST", "/api/projects", v),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["projects"] }),
  });
};

export const usePatchProject = (id: string) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: ProjectPatch) => api<Project>("PATCH", `/api/projects/${id}`, v),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["projects"] }),
  });
};

/** Polls while a scan runs; when it ends, the project list is refreshed once. */
export function useScan() {
  const qc = useQueryClient();
  const status = useQuery({
    queryKey: ["projects", "scan"],
    queryFn: async () => {
      const next = await api<ProjectScanStatus>("GET", "/api/projects/scan");
      const was = qc.getQueryData<ProjectScanStatus>(["projects", "scan"]);
      if (was?.state === "running" && next.state === "idle")
        void qc.invalidateQueries({ queryKey: ["projects", "list"] });
      return next;
    },
    refetchInterval: (q) => (q.state.data?.state === "running" ? 750 : false),
  });
  const start = useMutation({
    mutationFn: () => api<ProjectScanStatus>("POST", "/api/projects/scan"),
    onSuccess: (s) => qc.setQueryData(["projects", "scan"], s),
  });
  return { status: status.data, start };
}
