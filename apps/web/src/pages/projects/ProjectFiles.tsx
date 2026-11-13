import type {
  HubFileSaved,
  ProjectDetail,
  ProjectFileEntry,
  ProjectFilesList,
} from "@3d-maker-suite/core";
import { useQueryClient } from "@tanstack/react-query";
import {
  ChevronDown,
  ChevronRight,
  Download,
  File as FileIcon,
  Folder,
  FolderInput,
  FolderPlus,
  History,
  Pencil,
  RefreshCw,
  Trash2,
  Upload,
} from "lucide-react";
import { type DragEvent, type ReactNode, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { AddDialog } from "../../components/AddDialog.tsx";
import { Button } from "../../components/Button.tsx";
import { Collapsible } from "../../components/Collapsible.tsx";
import { Combobox } from "../../components/Combobox.tsx";
import { ConfirmDialog } from "../../components/ConfirmDialog.tsx";
import { FormField, inputClass } from "../../components/FormField.tsx";
import { Write } from "../../components/Write.tsx";
import { ApiError } from "../../lib/api.ts";
import { useCan } from "../../lib/auth.ts";
import { cx, textLink } from "../../lib/cx.ts";
import { formatDateTime, formatRelative, formatSize } from "../../lib/format.ts";
import { usePreferences } from "../../lib/preferences.ts";
import {
  uploadProjectFile,
  useProjectFileActions,
  useProjectFolder,
  useProjectFolders,
} from "../../lib/projectFiles.ts";
import {
  fileVersionUrl,
  projectDownloadUrl,
  useFileVersions,
  useProjectSaved,
} from "../../lib/projects.ts";

const join = (dir: string, name: string) => (dir ? `${dir}/${name}` : name);
const dirOf = (p: string) => p.slice(0, Math.max(p.lastIndexOf("/"), 0));
const clean = (p: string) => p.trim().replace(/^\/+|\/+$/g, "");

type Ask =
  | { kind: "folder"; dir: string }
  | { kind: "rename" | "move" | "delete"; entry: ProjectFileEntry }
  | { kind: "bulkMove" | "bulkDelete"; paths: string[] };
type Transfer = { key: number; name: string; fraction: number };
type Ctx = {
  projectId: string;
  canEdit: boolean;
  onFiles: (dir: string, files: FileList | File[]) => void;
  onReplace: (path: string, file: File) => void;
  ask: (a: Ask) => void;
  selected: Set<string>;
  toggle: (path: string) => void;
  /** Shows a file's kept versions; none while the hub is off. */
  history?: (path: string) => void;
  /** Who saved each file last, by path. */
  saved: Map<string, HubFileSaved>;
};

/** "Last saved by", information only; nothing when unknown. */
function SavedBy({
  saved,
  className = "",
}: {
  saved: HubFileSaved | undefined;
  className?: string;
}) {
  const { t } = useTranslation();
  if (!saved) return null;
  const ago = formatRelative(saved.savedAt);
  return (
    <span
      className={`min-w-0 text-muted text-sm wrap-anywhere ${className}`}
      title={formatDateTime(saved.savedAt)}
    >
      {saved.device
        ? t("projects:files.savedBy", { user: saved.user, device: saved.device, ago })
        : t("projects:files.savedByWeb", { user: saved.user, ago })}
    </span>
  );
}

/** A hidden file input that a button opens; keeps the picker keyboard reachable through the button. */
function FilePick({
  inputRef,
  multiple,
  onFiles,
}: {
  inputRef: React.RefObject<HTMLInputElement | null>;
  multiple?: boolean;
  onFiles: (files: FileList) => void;
}) {
  return (
    <input
      ref={inputRef}
      type="file"
      multiple={multiple}
      hidden
      tabIndex={-1}
      onChange={(e) => {
        if (e.target.files?.length) onFiles(e.target.files);
        e.target.value = "";
      }}
    />
  );
}

function IconButton({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <Button
      variant="ghost"
      className="h-10 w-10 px-0 sm:h-9 sm:w-9"
      aria-label={label}
      onClick={onClick}
    >
      {children}
    </Button>
  );
}

/** A download (file or zip) the browser saves; icon only, named by `label`, when it has no text. */
function DownloadLink({
  href,
  label,
  children,
}: {
  href: string;
  label: string;
  children?: ReactNode;
}) {
  return (
    <a
      href={href}
      download
      aria-label={children ? undefined : label}
      title={children ? undefined : label}
      className={cx(
        "inline-flex shrink-0 items-center justify-center gap-2 rounded-md font-medium transition-colors hover:bg-surface-2",
        children ? "h-9 border border-border bg-surface px-3" : "h-10 w-10 sm:h-9 sm:w-9",
      )}
    >
      <Download className="size-4" aria-hidden />
      {children}
    </a>
  );
}

function VersionsDialog({
  projectId,
  file,
  onClose,
}: {
  projectId: string;
  file: string | null;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const versions = useFileVersions(projectId, file);
  return (
    <AddDialog
      open={file !== null}
      title={t("projects:files.versions.title", { name: file?.split("/").pop() ?? "" })}
      onClose={onClose}
    >
      {versions.isError ? (
        <p role="alert" className="text-bad">
          {t("projects:files.versions.error")}
        </p>
      ) : versions.data?.length ? (
        <table className="w-full text-left">
          <thead>
            <tr className="text-muted">
              <th className="py-1 pr-3 font-medium">{t("projects:files.versions.version")}</th>
              <th className="py-1 pr-3 font-medium">{t("projects:files.versions.by")}</th>
              <th className="py-1 pr-3 font-medium">{t("projects:files.versions.date")}</th>
              <th className="py-1 pr-3 font-medium">{t("projects:files.versions.size")}</th>
              <th className="py-1">
                <span className="sr-only">{t("projects:files.versions.download")}</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {versions.data.map((v) => (
              <tr key={v.version} className="border-border border-t">
                <td className="py-1 pr-3">{v.version}</td>
                <td className="py-1 pr-3 wrap-anywhere">
                  {v.user
                    ? t("projects:files.versions.userOnDevice", { user: v.user, device: v.device })
                    : t("projects:files.versions.hub")}
                </td>
                <td className="py-1 pr-3">{formatDateTime(v.savedAt)}</td>
                <td className="py-1 pr-3">{formatSize(v.size)}</td>
                <td className="py-1">
                  <a
                    className={textLink}
                    href={fileVersionUrl(projectId, file ?? "", v.version)}
                    download
                  >
                    {t("projects:files.versions.download")}
                  </a>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p className="text-muted">{t("projects:files.versions.empty")}</p>
      )}
    </AddDialog>
  );
}

function Row({ entry, depth, ctx }: { entry: ProjectFileEntry; depth: number; ctx: Ctx }) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [over, setOver] = useState(false);
  const upload = useRef<HTMLInputElement>(null);
  const replace = useRef<HTMLInputElement>(null);
  const dir = entry.type === "dir";
  const n = { name: entry.name };
  const drop = (e: DragEvent) => {
    if (!dir) return;
    e.preventDefault();
    e.stopPropagation();
    setOver(false);
    ctx.onFiles(entry.path, e.dataTransfer.files);
  };
  return (
    <li>
      {/* biome-ignore lint/a11y/noStaticElementInteractions: drop target; uploading has button equivalents */}
      <div
        onDragOver={(e) => {
          if (!dir) return;
          e.preventDefault();
          e.stopPropagation();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={drop}
        style={{ paddingLeft: `${0.5 + depth * 1.25}rem` }}
        className={`flex flex-wrap items-center gap-x-2 py-1 pr-2 ${over ? "bg-surface-2 outline outline-accent" : ""}`}
      >
        <Write can="projects" when={ctx.canEdit}>
          <input
            type="checkbox"
            className="size-5 shrink-0 accent-accent"
            aria-label={t("projects:files.select", n)}
            checked={ctx.selected.has(entry.path)}
            onChange={() => ctx.toggle(entry.path)}
          />
        </Write>
        {dir ? (
          <button
            type="button"
            aria-expanded={open}
            onClick={() => setOpen(!open)}
            className="inline-flex min-h-9 min-w-0 grow basis-48 items-center gap-2 text-left"
          >
            {open ? (
              <ChevronDown className="size-4 shrink-0" aria-hidden />
            ) : (
              <ChevronRight className="size-4 shrink-0" aria-hidden />
            )}
            <Folder className="size-4 shrink-0 text-muted" aria-hidden />
            <span className="break-all font-medium">{entry.name}</span>
          </button>
        ) : (
          <span className="flex min-h-9 min-w-0 grow basis-48 items-center gap-2 pl-6">
            <FileIcon className="size-4 shrink-0 text-muted" aria-hidden />
            <span className="break-all">{entry.name}</span>
            <span className="shrink-0 text-muted">{formatSize(entry.size)}</span>
          </span>
        )}
        {!dir && <SavedBy saved={ctx.saved.get(entry.path)} />}
        <DownloadLink
          href={projectDownloadUrl(ctx.projectId, entry.path)}
          label={t("projects:files.download", n)}
        />
        {ctx.history && !dir && (
          <IconButton
            label={t("projects:files.history", n)}
            onClick={() => ctx.history?.(entry.path)}
          >
            <History className="size-4" aria-hidden />
          </IconButton>
        )}
        <Write can="projects" when={ctx.canEdit}>
          <span className="flex shrink-0 gap-1">
            {dir ? (
              <>
                <IconButton
                  label={t("projects:files.uploadTo", n)}
                  onClick={() => upload.current?.click()}
                >
                  <Upload className="size-4" aria-hidden />
                </IconButton>
                <IconButton
                  label={t("projects:files.newFolderIn", n)}
                  onClick={() => ctx.ask({ kind: "folder", dir: entry.path })}
                >
                  <FolderPlus className="size-4" aria-hidden />
                </IconButton>
              </>
            ) : (
              <IconButton
                label={t("projects:files.replace", n)}
                onClick={() => replace.current?.click()}
              >
                <RefreshCw className="size-4" aria-hidden />
              </IconButton>
            )}
            <IconButton
              label={t("projects:files.rename", n)}
              onClick={() => ctx.ask({ kind: "rename", entry })}
            >
              <Pencil className="size-4" aria-hidden />
            </IconButton>
            <IconButton
              label={t("projects:files.move", n)}
              onClick={() => ctx.ask({ kind: "move", entry })}
            >
              <FolderInput className="size-4" aria-hidden />
            </IconButton>
            <IconButton
              label={t("projects:files.delete", n)}
              onClick={() => ctx.ask({ kind: "delete", entry })}
            >
              <Trash2 className="size-4 text-bad" aria-hidden />
            </IconButton>
          </span>
        </Write>
        {dir ? (
          <FilePick inputRef={upload} multiple onFiles={(f) => ctx.onFiles(entry.path, f)} />
        ) : (
          <FilePick inputRef={replace} onFiles={(f) => ctx.onReplace(entry.path, f[0] as File)} />
        )}
      </div>
      {dir && open && <Children path={entry.path} depth={depth + 1} ctx={ctx} />}
    </li>
  );
}

function Children({ path, depth, ctx }: { path: string; depth: number; ctx: Ctx }) {
  const { t } = useTranslation();
  const { data, isError } = useProjectFolder(ctx.projectId, path);
  if (isError)
    return (
      <p role="alert" className="p-2 text-bad">
        {t("projects:files.loadError")}
      </p>
    );
  if (!data) return null;
  if (!data.entries.length)
    return (
      <p style={{ paddingLeft: `${0.5 + depth * 1.25}rem` }} className="py-2 text-muted">
        {t("projects:files.empty")}
      </p>
    );
  return (
    <ul className={depth ? "" : "divide-y divide-border"}>
      {data.entries.map((e) => (
        <Row key={e.path} entry={e} depth={depth} ctx={ctx} />
      ))}
    </ul>
  );
}

/** Why a file action failed, for the user. */
function useErrorText() {
  const { t } = useTranslation();
  return (e: unknown) => {
    const code = e instanceof ApiError ? e.code : undefined;
    if (code === "path_exists") return t("projects:files.exists");
    if (code === "file_too_large") return t("projects:files.tooLarge");
    if (code === "device_offline") return t("common:pathPicker.deviceOffline");
    if (code === "device_timeout") return t("common:pathPicker.deviceTimeout");
    if (code === "device_outdated") return t("common:pathPicker.deviceOutdated");
    return t("projects:files.error");
  };
}

/**
 * Uploads into a project's folder (picker, drop, replace), one file at a time: progress, errors,
 * the question before replacing a name, and the uploads kept as conflict copies. `sha256Of`: the
 * hash the page listed for a path (the server checks the file is still that).
 */
function useUploads(project: ProjectDetail, sha256Of: (path: string) => string | undefined) {
  const { t } = useTranslation();
  const id = project.id;
  const errorText = useErrorText();
  const actions = useProjectFileActions(id);
  const seq = useRef(0);
  const [uploads, setUploads] = useState<Transfer[]>([]);
  const [failed, setFailed] = useState<string | null>(null);
  const [kept, setKept] = useState<{ name: string; copy: string }[]>([]);
  const [question, setQuestion] = useState<{
    path: string;
    answer: (replace: boolean) => void;
  } | null>(null);
  const canWrite = useCan("projects") && project.canEdit;

  const send = async (path: string, file: File, replace: boolean): Promise<void> => {
    const key = ++seq.current;
    setUploads((u) => [...u, { key, name: path, fraction: 0 }]);
    const progress = (fraction: number) =>
      setUploads((u) => u.map((x) => (x.key === key ? { ...x, fraction } : x)));
    try {
      const r = await uploadProjectFile(id, path, file, replace, sha256Of(path), progress);
      if (r.conflict) setKept((k) => [...k, { name: path, copy: r.path }]);
    } catch (e) {
      // An existing name never gets replaced silently: ask first.
      if (e instanceof ApiError && e.code === "path_exists" && !replace) {
        setUploads((u) => u.filter((x) => x.key !== key));
        const yes = await new Promise<boolean>((answer) => setQuestion({ path, answer }));
        if (yes) return send(path, file, true);
      } else setFailed(`${path}: ${errorText(e)}`);
    } finally {
      setUploads((u) => u.filter((x) => x.key !== key));
    }
  };
  const start = () => {
    setFailed(null);
    setKept([]);
  };

  return {
    errorText,
    setFailed,
    async onFiles(dir: string, files: FileList | File[]) {
      if (!canWrite) return;
      start();
      for (const f of Array.from(files)) await send(join(dir, f.name), f, false);
      actions.done();
    },
    async onReplace(path: string, file: File) {
      start();
      await send(path, file, true);
      actions.done();
    },
    view: (
      <>
        {uploads.length > 0 && (
          <ul className="mb-2 grid gap-2" aria-live="polite">
            {uploads.map((u) => (
              <li
                key={u.key}
                className="flex flex-col gap-1 rounded-md border border-border bg-surface-2 p-2"
              >
                <span className="break-all">{t("projects:files.uploading", { name: u.name })}</span>
                <progress
                  className="h-2 w-full accent-accent"
                  aria-label={u.name}
                  value={u.fraction}
                  max={1}
                />
              </li>
            ))}
          </ul>
        )}
        {failed && (
          <p role="alert" className="mb-2 text-bad">
            {failed}
          </p>
        )}
        {kept.length > 0 && (
          <ul role="status" className="mb-2 grid gap-1 text-warn">
            {kept.map((k) => (
              <li key={k.copy} className="wrap-anywhere">
                {t("projects:files.conflictKept", k)}
              </li>
            ))}
          </ul>
        )}
        <ConfirmDialog
          open={!!question}
          title={t("projects:files.replaceTitle")}
          description={t("projects:files.replaceHint", { name: question?.path ?? "" })}
          confirmLabel={t("projects:files.replaceAction")}
          destructive
          onConfirm={() => {
            question?.answer(true);
            setQuestion(null);
          }}
          onCancel={() => {
            question?.answer(false);
            setQuestion(null);
          }}
        />
      </>
    ),
  };
}

/** The project folder as a tree: create, rename, move, delete, upload (picker or drop) and replace. */
export function ProjectFiles({ project }: { project: ProjectDetail }) {
  const { t } = useTranslation();
  const id = project.id;
  const qc = useQueryClient();
  const actions = useProjectFileActions(id);
  const picker = useRef<HTMLInputElement>(null);
  const [ask, setAsk] = useState<Ask | null>(null);
  const folders = useProjectFolders(id, ask?.kind === "move" || ask?.kind === "bulkMove");
  const top = useProjectFolder(id, "").data?.entries ?? [];
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [value, setValue] = useState("");
  const [over, setOver] = useState(false);
  const saved = useProjectSaved(id).data ?? [];
  const hubOn = usePreferences().data?.values.hubEnabled;
  const [history, setHistory] = useState<string | null>(null);
  // The hash its folder's list gave (while the hub is on).
  const { errorText, setFailed, onFiles, onReplace, view } = useUploads(
    project,
    (path) =>
      qc
        .getQueryData<ProjectFilesList>(["projects", id, "files", dirOf(path)])
        ?.entries.find((e) => e.path === path)?.sha256,
  );

  if (!project.folderPath) return null;

  const toggle = (path: string) =>
    setSelected((s) => {
      const next = new Set(s);
      if (!next.delete(path)) next.add(path);
      return next;
    });
  // Selecting a folder covers its contents, so drop selected paths that sit inside another one.
  const picked = [...selected].filter(
    (p) => ![...selected].some((o) => o !== p && p.startsWith(`${o}/`)),
  );
  // "All" is the top level: every folder in it comes with what it holds.
  const allSelected = top.length > 0 && top.every((e) => selected.has(e.path));
  const toggleAll = () => setSelected(allSelected ? new Set() : new Set(top.map((e) => e.path)));

  const close = () => setAsk(null);
  const submit = () => {
    if (!ask) return;
    const v = clean(value);
    const cb = {
      onSuccess: () => {
        close();
        setSelected(new Set());
      },
      onError: (e: unknown) => {
        close();
        setFailed(errorText(e));
      },
    };
    setFailed(null);
    if ("paths" in ask) {
      // One by one; whatever fails (e.g. the name exists there) stays selected and is reported.
      void (async () => {
        const left = new Set<string>();
        let error: unknown;
        for (const from of ask.paths) {
          try {
            if (ask.kind === "bulkDelete") await actions.remove.mutateAsync(from);
            else
              await actions.move.mutateAsync({
                from,
                to: join(v, from.slice(from.lastIndexOf("/") + 1)),
              });
          } catch (e) {
            left.add(from);
            error = e;
          }
        }
        close();
        setSelected(left);
        if (left.size)
          setFailed(`${t("projects:files.bulkFailed", { count: left.size })} ${errorText(error)}`);
      })();
    } else if (ask.kind === "delete") actions.remove.mutate(ask.entry.path, cb);
    else if (ask.kind === "folder") {
      if (v) actions.mkdir.mutate(join(ask.dir, v), cb);
    } else if (ask.kind === "rename") {
      if (v) actions.move.mutate({ from: ask.entry.path, to: join(dirOf(ask.entry.path), v) }, cb);
    } else actions.move.mutate({ from: ask.entry.path, to: join(v, ask.entry.name) }, cb);
  };
  const open = (a: Ask) => {
    setValue(a.kind === "rename" ? a.entry.name : a.kind === "move" ? dirOf(a.entry.path) : "");
    setAsk(a);
  };
  const name = ask && "entry" in ask ? ask.entry.name : "";
  const count = ask && "paths" in ask ? ask.paths.length : 0;
  // Folders a move can go to: not into a moved folder or below it.
  const moving =
    ask?.kind === "move" ? [ask.entry.path] : ask?.kind === "bulkMove" ? ask.paths : [];
  // Static keys so `pnpm i18n:check` sees them.
  const text = {
    folder: [
      t("projects:files.folderTitle"),
      t("projects:files.folderHint"),
      t("projects:files.createAction"),
    ],
    rename: [
      t("projects:files.renameTitle", { name }),
      t("projects:files.renameHint"),
      t("projects:files.renameAction"),
    ],
    move: [
      t("projects:files.moveTitle", { name }),
      t("projects:files.moveHint"),
      t("projects:files.moveAction"),
    ],
    delete: [
      t("projects:files.deleteTitle", { name }),
      t("projects:files.deleteHint"),
      t("projects:files.deleteAction"),
    ],
    bulkMove: [
      t("projects:files.bulkMoveTitle", { count }),
      t("projects:files.moveHint"),
      t("projects:files.moveAction"),
    ],
    bulkDelete: [
      t("projects:files.bulkDeleteTitle", { count }),
      t("projects:files.deleteHint"),
      t("projects:files.deleteAction"),
    ],
  }[ask?.kind ?? "folder"];

  return (
    <Collapsible
      title={t("projects:detail.files")}
      className={`mt-6 rounded-lg ${over ? "outline-2 outline-accent" : ""}`}
      onDragOver={(e) => {
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={(e) => e.currentTarget.contains(e.relatedTarget as Node) || setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        onFiles("", e.dataTransfer.files);
      }}
    >
      <div className="mb-2 flex flex-wrap items-center justify-end gap-2">
        <DownloadLink href={projectDownloadUrl(id, "")} label={t("projects:files.downloadAll")}>
          {t("projects:files.downloadAll")}
        </DownloadLink>
        <Write can="projects" when={project.canEdit}>
          <Button onClick={() => picker.current?.click()}>
            <Upload className="size-4" aria-hidden />
            {t("projects:files.upload")}
          </Button>
          <Button onClick={() => open({ kind: "folder", dir: "" })}>
            <FolderPlus className="size-4" aria-hidden />
            {t("projects:files.newFolder")}
          </Button>
          <FilePick inputRef={picker} multiple onFiles={(f) => onFiles("", f)} />
        </Write>
      </div>
      <Write can="projects" when={project.canEdit}>
        <p className="mb-2 text-muted">{t("projects:files.dropHint")}</p>
      </Write>
      {view}
      <Write can="projects" when={project.canEdit}>
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <label className="mr-auto flex min-h-9 items-center gap-2">
            <input
              type="checkbox"
              className="size-5 accent-accent"
              checked={allSelected}
              disabled={!top.length}
              onChange={toggleAll}
            />
            {t("projects:files.selectAll")}
          </label>
          <span className="text-muted" aria-live="polite">
            {t("projects:files.selected", { count: picked.length })}
          </span>
          <Button
            disabled={!picked.length}
            onClick={() => open({ kind: "bulkMove", paths: picked })}
          >
            <FolderInput className="size-4" aria-hidden />
            {t("projects:files.bulkMove")}
          </Button>
          <Button
            disabled={!picked.length}
            onClick={() => open({ kind: "bulkDelete", paths: picked })}
          >
            <Trash2 className="size-4 text-bad" aria-hidden />
            {t("projects:files.bulkDelete")}
          </Button>
        </div>
      </Write>
      <div className="rounded-lg border border-border bg-surface">
        <Children
          path=""
          depth={0}
          ctx={{
            projectId: id,
            canEdit: project.canEdit,
            onFiles,
            onReplace,
            ask: open,
            selected,
            toggle,
            history: hubOn ? setHistory : undefined,
            saved: new Map(saved.map((s) => [s.file, s])),
          }}
        />
      </div>
      <VersionsDialog projectId={id} file={history} onClose={() => setHistory(null)} />
      <ConfirmDialog
        open={!!ask}
        title={text[0] as string}
        description={text[1] as string}
        confirmLabel={text[2] as string}
        destructive={ask?.kind === "delete" || ask?.kind === "bulkDelete"}
        onConfirm={submit}
        onCancel={close}
      >
        {ask && ask.kind !== "delete" && ask.kind !== "bulkDelete" && (
          <FormField
            label={t(
              ask.kind === "move" || ask.kind === "bulkMove"
                ? "projects:files.destination"
                : "projects:files.name",
            )}
          >
            {(p) =>
              ask.kind === "move" || ask.kind === "bulkMove" ? (
                <Combobox
                  {...p}
                  value={value}
                  onChange={setValue}
                  options={[
                    { value: "", label: t("projects:files.projectFolder") },
                    ...(folders.data ?? [])
                      // Not into itself or below it.
                      .filter((f) => !moving.some((m) => f === m || f.startsWith(`${m}/`)))
                      .map((f) => ({ value: f, label: f })),
                  ]}
                />
              ) : (
                <input
                  {...p}
                  className={inputClass}
                  value={value}
                  // biome-ignore lint/a11y/noAutofocus: the dialog exists only to fill this field
                  autoFocus
                  onChange={(e) => setValue(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key !== "Enter") return;
                    e.preventDefault();
                    submit();
                  }}
                />
              )
            }
          </FormField>
        )}
      </ConfirmDialog>
    </Collapsible>
  );
}

/** An icon button that opens a file picker. */
function PickButton({
  label,
  multiple,
  onFiles,
  children,
}: {
  label: string;
  multiple?: boolean;
  onFiles: (files: FileList) => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <>
      <IconButton label={label} onClick={() => ref.current?.click()}>
        {children}
      </IconButton>
      <FilePick inputRef={ref} multiple={multiple} onFiles={onFiles} />
    </>
  );
}

/**
 * The files of a project in a device root (ADR-0014), as its device's last scan listed them: the
 * hub pulls each from the device to download it, and its connector writes uploads there (online
 * only). Other edits happen on the device.
 */
export function DeviceFileList({ project }: { project: ProjectDetail }) {
  const { t } = useTranslation();
  const files = project.meta.files.filter((f) => f.kind !== "shortcut");
  const saved = new Map((useProjectSaved(project.id).data ?? []).map((s) => [s.file, s]));
  const hubOn = usePreferences().data?.values.hubEnabled;
  const [history, setHistory] = useState<string | null>(null);
  const [over, setOver] = useState(false);
  const picker = useRef<HTMLInputElement>(null);
  // The hash its device's scan gave.
  const { onFiles, onReplace, view } = useUploads(
    project,
    (path) => files.find((f) => f.path === path)?.sha256,
  );
  const online = project.folderState === "ok";
  if (!online && project.folderState !== "offline") return null;
  if (online && !files.length && !project.canEdit) return null;
  /** Upload buttons: only while its device is online. */
  const write = (node: ReactNode) =>
    online && (
      <Write can="projects" when={project.canEdit}>
        {node}
      </Write>
    );
  // Every folder that holds a listed file (also through a subfolder), in tree order.
  const folders = [
    ...new Set(
      files.flatMap((f) => {
        const parts = f.path.split("/").slice(0, -1);
        return parts.map((_, i) => parts.slice(0, i + 1).join("/"));
      }),
    ),
  ].sort((a, b) => (a.replaceAll("/", "\0") < b.replaceAll("/", "\0") ? -1 : 1));
  const indent = (path: string) => ({
    paddingLeft: `${0.5 + (path ? path.split("/").length : 0) * 1.25}rem`,
  });
  const download = (path: string, name: string) =>
    online && (
      <DownloadLink
        href={projectDownloadUrl(project.id, path)}
        label={t("projects:files.download", { name })}
      />
    );
  return (
    <Collapsible
      title={t("projects:detail.files")}
      className={`mt-6 rounded-lg ${over ? "outline-2 outline-accent" : ""}`}
      onDragOver={(e) => {
        if (!online) return;
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={(e) => e.currentTarget.contains(e.relatedTarget as Node) || setOver(false)}
      onDrop={(e) => {
        if (!online) return;
        e.preventDefault();
        setOver(false);
        onFiles("", e.dataTransfer.files);
      }}
    >
      {online ? (
        <>
          <div className="mb-2 flex flex-wrap items-center justify-end gap-2">
            {files.length > 0 && (
              <DownloadLink
                href={projectDownloadUrl(project.id, "")}
                label={t("projects:files.downloadAll")}
              >
                {t("projects:files.downloadAll")}
              </DownloadLink>
            )}
            {write(
              <>
                <Button onClick={() => picker.current?.click()}>
                  <Upload className="size-4" aria-hidden />
                  {t("projects:files.upload")}
                </Button>
                <FilePick inputRef={picker} multiple onFiles={(f) => onFiles("", f)} />
              </>,
            )}
          </div>
          {write(<p className="mb-2 text-muted">{t("projects:files.dropHint")}</p>)}
        </>
      ) : (
        <p className="mb-2 text-muted">{t("projects:files.deviceOffline")}</p>
      )}
      {view}
      <ul className="divide-y divide-border rounded-lg border border-border bg-surface">
        {["", ...folders].map((dir) => {
          const name = dir.slice(dir.lastIndexOf("/") + 1);
          const inside = files.filter((f) => dirOf(f.path) === dir);
          if (!dir && !inside.length) return null;
          return (
            <li key={dir}>
              {dir && (
                <div style={indent(dirOf(dir))} className="flex items-center gap-2 py-1 pr-2">
                  <span className="flex min-h-9 min-w-0 grow items-center gap-2">
                    <Folder className="size-4 shrink-0 text-muted" aria-hidden />
                    <span className="break-all font-medium">{name}</span>
                  </span>
                  {download(dir, name)}
                  {write(
                    <PickButton
                      label={t("projects:files.uploadTo", { name })}
                      multiple
                      onFiles={(f) => onFiles(dir, f)}
                    >
                      <Upload className="size-4" aria-hidden />
                    </PickButton>,
                  )}
                </div>
              )}
              <ul>
                {inside.map((f) => {
                  const file = f.path.slice(f.path.lastIndexOf("/") + 1);
                  return (
                    <li
                      key={f.path}
                      style={indent(dir)}
                      className="flex flex-wrap items-center gap-x-2 py-1 pr-2"
                    >
                      <span className="flex min-h-9 min-w-0 grow basis-48 items-center gap-2">
                        <FileIcon className="size-4 shrink-0 text-muted" aria-hidden />
                        <span className="break-all">{file}</span>
                        <span className="shrink-0 text-muted">{formatSize(f.size)}</span>
                      </span>
                      <SavedBy saved={saved.get(f.path)} />
                      {download(f.path, file)}
                      {hubOn && online && !!f.versions?.length && (
                        <IconButton
                          label={t("projects:files.history", { name: file })}
                          onClick={() => setHistory(f.path)}
                        >
                          <History className="size-4" aria-hidden />
                        </IconButton>
                      )}
                      {write(
                        <PickButton
                          label={t("projects:files.replace", { name: file })}
                          onFiles={(picked) => onReplace(f.path, picked[0] as File)}
                        >
                          <RefreshCw className="size-4" aria-hidden />
                        </PickButton>,
                      )}
                    </li>
                  );
                })}
              </ul>
            </li>
          );
        })}
      </ul>
      <VersionsDialog projectId={project.id} file={history} onClose={() => setHistory(null)} />
    </Collapsible>
  );
}
