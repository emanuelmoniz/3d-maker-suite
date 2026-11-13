import type { ProjectDetail, ProjectFilesList, ProjectUploadResult } from "@3d-maker-suite/core";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ApiError, api } from "./api.ts";

const base = (id: string) => `/api/projects/${id}/files`;
const q = (o: Record<string, string>) => new URLSearchParams(o).toString();

/** One folder's entries ("" is the project folder). */
export const useProjectFolder = (id: string, path: string, enabled = true) =>
  useQuery({
    queryKey: ["projects", id, "files", path],
    queryFn: () => api<ProjectFilesList>("GET", `${base(id)}?${q({ path })}`),
    enabled,
  });

/** Every folder path in the project, for the move picker. Walks the tree one level at a time. */
export const useProjectFolders = (id: string, enabled: boolean) =>
  useQuery({
    queryKey: ["projects", id, "folders"],
    enabled,
    // Always fresh: a dialog opened after a change must see it.
    staleTime: 0,
    queryFn: async () => {
      const out: string[] = [];
      const queue = [""];
      for (let dir = queue.shift(); dir !== undefined; dir = queue.shift()) {
        const { entries } = await api<ProjectFilesList>("GET", `${base(id)}?${q({ path: dir })}`);
        for (const e of entries)
          if (e.type === "dir") {
            out.push(e.path);
            queue.push(e.path);
          }
      }
      return out;
    },
  });

/** Every change re-scans the project on the server, so refetch the folders and the project. */
export const useProjectFileActions = (id: string) => {
  const qc = useQueryClient();
  const done = () => qc.invalidateQueries({ queryKey: ["projects"] });
  return {
    mkdir: useMutation({
      mutationFn: (path: string) => api("POST", `${base(id)}/folders`, { path }),
      onSuccess: done,
    }),
    move: useMutation({
      mutationFn: (v: { from: string; to: string }) => api("POST", `${base(id)}/move`, v),
      onSuccess: done,
    }),
    remove: useMutation({
      mutationFn: (path: string) => api("DELETE", `${base(id)}?${q({ path })}`),
      onSuccess: done,
    }),
    done,
  };
};

/**
 * A file's hash as the server lists it now: a device root's from its last scan, else from its
 * folder's list (while the hub is on). ponytail: taken when saving, so a form that replaces a file
 * overwrites a change made since it opened; take it on open if that matters.
 */
export async function listedSha256(project: ProjectDetail, path: string) {
  const scanned = project.meta.files.find((f) => f.path === path)?.sha256;
  if (scanned) return scanned;
  const dir = path.slice(0, Math.max(path.lastIndexOf("/"), 0));
  const list = await api<ProjectFilesList>("GET", `${base(project.id)}?${q({ path: dir })}`).catch(
    () => null,
  );
  return list?.entries.find((e) => e.path === path)?.sha256;
}

/**
 * PUT one file as a raw body. XHR, because fetch can't report upload progress. `sha256`: the hash
 * of the file it replaces, as listed; the server keeps the upload as a conflict copy when that
 * file changed since.
 */
export const uploadProjectFile = (
  id: string,
  path: string,
  file: File,
  replace: boolean,
  sha256: string | undefined,
  onProgress: (fraction: number) => void,
) =>
  new Promise<ProjectUploadResult>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    const query = { path, replace: String(replace), ...(sha256 && { base: sha256 }) };
    xhr.open("PUT", `${base(id)}/content?${q(query)}`);
    xhr.setRequestHeader("content-type", "application/octet-stream");
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress(e.loaded / e.total);
    xhr.onerror = () => reject(new ApiError("upload failed"));
    xhr.onload = () => {
      if (xhr.status < 300) {
        try {
          return resolve(JSON.parse(xhr.responseText));
        } catch {
          return resolve({ path });
        }
      }
      let e: { code?: string; message?: string } | undefined;
      try {
        e = JSON.parse(xhr.responseText)?.error;
      } catch {}
      reject(new ApiError(`PUT failed: ${xhr.status}`, e?.code, e?.message));
    };
    xhr.send(file);
  });
