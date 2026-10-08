import type {
  Page,
  Project,
  ProjectInput,
  ProjectOpen,
  ProjectPatch,
  ProjectScanStatus,
} from "@3d-maker-suite/core";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "./api.ts";

// ponytail: one page of 100 projects, add pagination controls if libraries get bigger.
// Tag and collection filter on the server; material, multicolor and search on the page.
export const useProjects = (f: { tagId?: string; collectionId?: string } = {}) => {
  const q = new URLSearchParams({ pageSize: "100", sort: "name" });
  if (f.tagId) q.set("tagId", f.tagId);
  if (f.collectionId) q.set("collectionId", f.collectionId);
  return useQuery({
    queryKey: ["projects", "list", f.tagId ?? "", f.collectionId ?? ""],
    queryFn: () => api<Page<Project>>("GET", `/api/projects?${q}`),
  });
};

export const useProject = (id: string) =>
  useQuery({
    queryKey: ["projects", id],
    queryFn: () => api<Project>("GET", `/api/projects/${id}`),
  });

export const projectThumbnailUrl = (p: Pick<Project, "id" | "updatedAt">) =>
  `/api/projects/${p.id}/thumbnail?v=${encodeURIComponent(p.updatedAt)}`;

/** A model/image of a project, or with `entry` a plate preview inside that 3MF. */
export const projectFileUrl = (id: string, path: string, entry?: string) =>
  `/api/projects/${id}/file?${new URLSearchParams(entry ? { path, entry } : { path })}`;

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

/** Opens a project folder or one of its models in the OS / the configured slicer (server-side). */
export const useOpenProject = (id: string) =>
  useMutation({
    mutationFn: (v: ProjectOpen) => api("POST", `/api/projects/${id}/open`, v),
  });
