import type { FsListResponse } from "@3d-maker-suite/core";
import { useQuery } from "@tanstack/react-query";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { api } from "../lib/api.ts";
import { Button } from "./Button.tsx";

type Sep = FsListResponse["sep"];

const fetchList = (q: Record<string, string>) =>
  api<FsListResponse>("GET", `/api/fs/list?${new URLSearchParams(q)}`);

/** The folder holding `p` ("C:\a\b.exe" → "C:\a"), or null when there's none to start from. */
const parentOf = (p: string) => {
  const dir = p.slice(0, Math.max(p.lastIndexOf("/"), p.lastIndexOf("\\")));
  return /^[A-Za-z]:$/.test(dir) ? `${dir}\\` : dir || (p.startsWith("/") ? "/" : null);
};

/** Path segments as crumbs: "C:\Users\me" → C:\ › Users › me, "/home/me" → / › home › me. */
const crumbs = (path: string, sep: Sep) => {
  const parts = path.split(sep);
  if (parts.length > 1 && parts.at(-1) === "") parts.pop();
  return parts.map((part, i) => ({
    label: part || sep,
    path: i === 0 ? part + sep : parts.slice(0, i + 1).join(sep),
  }));
};

/**
 * "Browse…" button + modal that lists folders on the server's machine, because a browser can't
 * hand over a full local path. The text input next to it stays the source of truth.
 */
export function PathPicker({
  label,
  mode,
  ext,
  initial,
  onPick,
  children,
}: {
  /** The field's label; titles the dialog and names the button for screen readers. */
  label: string;
  mode: "folder" | "file";
  /** Extension filter for file mode; gets the server's separator so it can differ per OS. */
  ext?: (sep: Sep) => string | undefined;
  initial?: string;
  onPick: (path: string) => void;
  /** Button text; default "Browse…". */
  children?: ReactNode;
}) {
  const { t } = useTranslation();
  const ref = useRef<HTMLDialogElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const [open, setOpen] = useState(false);
  const [path, setPath] = useState<string | null>(null);

  // Roots also tell us the server's separator, which the extension filter needs.
  const roots = useQuery({
    queryKey: ["fs", "roots"],
    queryFn: () => fetchList({}),
    enabled: open,
  });
  const sep = roots.data?.sep;
  const filter = sep && ext?.(sep);
  const dir = useQuery({
    queryKey: ["fs", path, mode, filter],
    queryFn: () => fetchList({ path: path ?? "", mode, ...(filter ? { ext: filter } : {}) }),
    enabled: open && !!path && !!sep,
    retry: false,
  });
  const data = path ? dir.data : roots.data;

  useEffect(() => {
    const d = ref.current;
    if (!d || open === d.open) return;
    if (open) d.showModal();
    else d.close();
  }, [open]);
  // Navigating replaces the list; keep keyboard focus in it.
  useEffect(() => listRef.current?.querySelector("button")?.focus(), [data]);

  const start = () => {
    const from = initial?.trim();
    setPath(from ? (mode === "folder" ? from : parentOf(from)) : null);
    setOpen(true);
  };
  const pick = (p: string) => {
    setOpen(false);
    onPick(p);
  };

  return (
    <>
      <Button onClick={start} aria-label={t("common:pathPicker.browseFor", { field: label })}>
        {children ?? t("common:pathPicker.browse")}
      </Button>
      {/* biome-ignore lint/a11y/useKeyWithClickEvents: backdrop click is a pointer shortcut; Escape closes natively */}
      <dialog
        ref={ref}
        aria-label={label}
        onCancel={(e) => {
          e.preventDefault();
          setOpen(false);
        }}
        onClick={(e) => e.target === ref.current && setOpen(false)}
        className="m-auto max-h-[85vh] w-[min(92vw,32rem)] flex-col gap-3 rounded-lg border border-border bg-surface p-5 text-fg open:flex"
      >
        <h2 className="text-base font-semibold">{label}</h2>
        <nav aria-label={t("common:pathPicker.location")} className="flex items-center gap-2">
          <Button
            variant="ghost"
            className="shrink-0"
            disabled={!path}
            onClick={() => setPath(dir.data?.parent ?? null)}
          >
            {t("common:pathPicker.up")}
          </Button>
          <ol className="flex min-w-0 flex-wrap items-center gap-1 text-sm">
            <li>
              <button type="button" className="underline" onClick={() => setPath(null)}>
                {t("common:pathPicker.roots")}
              </button>
            </li>
            {data?.path &&
              sep &&
              crumbs(data.path, sep).map((c) => (
                <li key={c.path} className="flex items-center gap-1 break-all">
                  <span aria-hidden="true">›</span>
                  <button type="button" className="underline" onClick={() => setPath(c.path)}>
                    {c.label}
                  </button>
                </li>
              ))}
          </ol>
        </nav>
        {path && dir.isError ? (
          <p role="alert" className="text-bad">
            {t("common:pathPicker.error")}
          </p>
        ) : data?.entries.length === 0 ? (
          <p className="text-muted">{t("common:pathPicker.empty")}</p>
        ) : (
          <ul
            ref={listRef}
            className="min-h-0 flex-1 overflow-y-auto rounded-md border border-border"
          >
            {data?.entries.map((e) => (
              <li key={e.path}>
                <button
                  type="button"
                  className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-surface-2 focus-visible:bg-surface-2"
                  onClick={() => (e.type === "dir" ? setPath(e.path) : pick(e.path))}
                >
                  <span aria-hidden="true">{e.type === "dir" ? "📁" : "📄"}</span>
                  <span className="break-all">{e.name}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
        <div className="flex justify-end gap-2">
          <Button onClick={() => setOpen(false)}>{t("common:actions.cancel")}</Button>
          {mode === "folder" && (
            <Button
              variant="primary"
              disabled={!dir.data?.path || !path}
              onClick={() => dir.data?.path && pick(dir.data.path)}
            >
              {t("common:pathPicker.select")}
            </Button>
          )}
        </div>
      </dialog>
    </>
  );
}
