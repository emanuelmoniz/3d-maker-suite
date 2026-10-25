import type {
  Page,
  Project,
  ProjectDetail,
  ProjectFolderInput,
  ProjectFolderRelease,
  ProjectFolderResult,
  ProjectInput,
  ProjectOpen,
  ProjectPaint,
  ProjectPatch,
  ProjectScanStatus,
  ProjectSlicing,
  ProjectSlicingInput,
  ProjectTrash,
} from "@3d-maker-suite/core";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { TFunction } from "i18next";
import { api } from "./api.ts";

// ponytail: one page of 100 projects, add pagination controls if libraries get bigger.
// Tag and collection filter on the server; material, multicolor and search on the page.
// Every project, for pickers (page by page, the API's limit); the projects page pages on the server.
export const useProjects = () =>
  useQuery({
    queryKey: ["projects", "list", "all"],
    queryFn: async () => {
      const items: Project[] = [];
      for (let page = 1; ; page++) {
        const p = await api<Page<Project>>(
          "GET",
          `/api/projects?pageSize=100&sort=name&page=${page}`,
        );
        items.push(...p.items);
        if (!p.items.length || items.length >= p.total) return { ...p, items };
      }
    },
  });

export const useProjectMaterials = () =>
  useQuery({
    queryKey: ["projects", "materials"],
    queryFn: () => api<string[]>("GET", "/api/projects/materials"),
  });

export const useProject = (id: string) =>
  useQuery({
    queryKey: ["projects", id],
    queryFn: () => api<ProjectDetail>("GET", `/api/projects/${id}`),
    enabled: !!id,
  });

/** Refused (409) while it has prints or orders, or its folder still has files. */
export const useDeleteProject = (id: string) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api("DELETE", `/api/projects/${id}`),
    onSuccess: () => {
      qc.removeQueries({ queryKey: ["projects", id] });
      return qc.invalidateQueries({ queryKey: ["projects", "list"] });
    },
  });
};

/** Whether the project's folder holds files, to offer moving them on a folder switch. */
export const useProjectFolderHasFiles = (id: string, enabled: boolean) =>
  useQuery({
    queryKey: ["projects", id, "folder-content"],
    queryFn: () => api<{ hasFiles: boolean }>("GET", `/api/projects/${id}/folder/content`),
    enabled,
    // Look again each time the dialog opens: files come and go.
    staleTime: 0,
  }).data?.hasFiles;

/** Links a folder (`path`) or makes one in a root; `unlink` lets go of it, to the trash or kept. */
export const useProjectFolder = (id: string) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: ProjectFolderInput | { unlink: ProjectFolderRelease }) =>
      "unlink" in v
        ? api<ProjectFolderResult>("DELETE", `/api/projects/${id}/folder?files=${v.unlink}`)
        : api<ProjectFolderResult>("POST", `/api/projects/${id}/folder`, v),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["projects"] }),
  });
};

export const projectThumbnailUrl = (p: Pick<Project, "id" | "updatedAt">) =>
  `/api/projects/${p.id}/thumbnail?v=${encodeURIComponent(p.updatedAt)}`;

/** A model/image of a project, or with `entry` a plate preview inside that 3MF. */
export const projectFileUrl = (id: string, path: string, entry?: string) =>
  `/api/projects/${id}/file?${new URLSearchParams(entry ? { path, entry } : { path })}`;

/** An image in the project folder (gallery), served through the folder's path guard. */
export const projectImageUrl = (id: string, path: string) =>
  `/api/projects/${id}/files/image?${new URLSearchParams({ path })}`;

/** Is this image in the gallery's folders (a "" folder is the whole project, others cover below)? */
export const inGalleryFolder = (gallery: Project["gallery"], path: string) =>
  gallery.folders.some((d) => d === "" || path.startsWith(`${d}/`));

/** The gallery's images: those under its folders plus the single picks, in file order. */
export const galleryImages = (p: Pick<Project, "gallery" | "meta">) =>
  p.meta.files.filter(
    (f) =>
      f.kind === "image" &&
      (inGalleryFolder(p.gallery, f.path) || p.gallery.images.includes(f.path)),
  );

/**
 * For `Markdown`: a relative link or image in a project doc (`docPath`, relative to the project
 * folder; null = the folder itself) becomes the served file. Null when the path leaves the folder
 * or is not a listed file (an image link must point at an image).
 */
export const projectDocResolver =
  (project: Pick<Project, "id" | "meta">, docPath: string | null) =>
  (src: string, kind: "image" | "link"): string | null => {
    const base = docPath?.includes("/")
      ? docPath.slice(0, docPath.lastIndexOf("/")).split("/")
      : [];
    const parts = src.startsWith("/") ? [] : [...base];
    let path: string;
    try {
      path = decodeURI(src.split(/[?#]/)[0] ?? "");
    } catch {
      return null;
    }
    for (const seg of path.split("/")) {
      if (!seg || seg === ".") continue;
      if (seg !== "..") parts.push(seg);
      else if (!parts.pop()) return null;
    }
    const rel = parts.join("/");
    const file = project.meta.files.find((f) => f.path === rel);
    if (!file || (kind === "image" && file.kind !== "image")) return null;
    return projectFileUrl(project.id, rel);
  };

/** Painted triangles of a 3MF; optional extra for the viewer, so failures just mean no paint. */
export const useProjectPaint = (id: string, path: string, enabled: boolean) =>
  useQuery({
    queryKey: ["projects", id, "paint", path],
    queryFn: () =>
      api<ProjectPaint>("GET", `/api/projects/${id}/paint?${new URLSearchParams({ path })}`),
    enabled,
    retry: false,
    staleTime: Number.POSITIVE_INFINITY,
  });

export const useCreateProject = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: ProjectInput) => api<Project>("POST", "/api/projects", v),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["projects"] }),
  });
};

/** Deleted project files waiting in the roots' trash folders. */
export const useProjectTrash = () =>
  useQuery({
    queryKey: ["projects", "trash"],
    queryFn: () => api<ProjectTrash>("GET", "/api/projects/trash"),
  });

export const useEmptyProjectTrash = () => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api("DELETE", "/api/projects/trash"),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["projects", "trash"] }),
  });
};

export const usePatchProject = (id: string) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: ProjectPatch) => api<Project>("PATCH", `/api/projects/${id}`, v),
    onSuccess: () => qc.invalidateQueries({ queryKey: ["projects"] }),
  });
};

/**
 * The plates a project prints, with each plate's state (`outdated` when the file changed) and
 * last slice. Polls while plates are being sliced; when that ends, the project list is refreshed.
 */
export const useProjectSlicing = (id: string) => {
  const qc = useQueryClient();
  return useQuery({
    queryKey: ["projects", id, "slicing"],
    queryFn: async () => {
      const next = await api<ProjectSlicing>("GET", `/api/projects/${id}/slicing`);
      const was = qc.getQueryData<ProjectSlicing>(["projects", id, "slicing"]);
      if (was?.plates.some((p) => p.job) && !next.plates.some((p) => p.job))
        void qc.invalidateQueries({ queryKey: ["projects", "list"] });
      return next;
    },
    enabled: !!id,
    refetchInterval: (q) => (q.state.data?.plates.some((p) => p.job) ? 1000 : false),
  });
};

/** Queues the plates that need slicing; progress comes from `useProjectSlicing`. */
export const useSliceProject = (id: string) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => api<ProjectSlicing>("POST", `/api/projects/${id}/slicing/run`),
    onSuccess: (data) => qc.setQueryData(["projects", id, "slicing"], data),
  });
};

export const useSaveProjectSlicing = (id: string) => {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (v: ProjectSlicingInput) =>
      api<ProjectSlicing>("PUT", `/api/projects/${id}/slicing`, v),
    onSuccess: (data) => qc.setQueryData(["projects", id, "slicing"], data),
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

/** The name a project goes by everywhere: "001-aquaterrario" (the number padded like the folders). */
export const projectName = (t: TFunction, p: Pick<Project, "number" | "name">) =>
  t("common:projectName", { number: String(p.number).padStart(3, "0"), name: p.name });
