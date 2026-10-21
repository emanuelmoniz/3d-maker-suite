import type { Project, ProjectFileEntry } from "@3d-maker-suite/core";
import {
  ChevronDown,
  ChevronRight,
  File as FileIcon,
  Folder,
  FolderInput,
  FolderPlus,
  Pencil,
  RefreshCw,
  Trash2,
  Upload,
} from "lucide-react";
import { type DragEvent, type ReactNode, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "../../components/Button.tsx";
import { Combobox } from "../../components/Combobox.tsx";
import { ConfirmDialog } from "../../components/ConfirmDialog.tsx";
import { FormField, inputClass } from "../../components/FormField.tsx";
import { ApiError } from "../../lib/api.ts";
import { formatSize } from "../../lib/format.ts";
import {
  uploadProjectFile,
  useProjectFileActions,
  useProjectFolder,
  useProjectFolders,
} from "../../lib/projectFiles.ts";

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
  onFiles: (dir: string, files: FileList | File[]) => void;
  onReplace: (path: string, file: File) => void;
  ask: (a: Ask) => void;
  selected: Set<string>;
  toggle: (path: string) => void;
};

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
        <input
          type="checkbox"
          className="size-5 shrink-0 accent-[var(--accent)]"
          aria-label={t("projects:files.select", n)}
          checked={ctx.selected.has(entry.path)}
          onChange={() => ctx.toggle(entry.path)}
        />
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
            <Trash2 className="size-4" aria-hidden />
          </IconButton>
        </span>
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

/** The project folder as a tree: create, rename, move, delete, upload (picker or drop) and replace. */
export function ProjectFiles({ project }: { project: Project }) {
  const { t } = useTranslation();
  const id = project.id;
  const actions = useProjectFileActions(id);
  const picker = useRef<HTMLInputElement>(null);
  const seq = useRef(0);
  const [ask, setAsk] = useState<Ask | null>(null);
  const folders = useProjectFolders(id, ask?.kind === "move" || ask?.kind === "bulkMove");
  const top = useProjectFolder(id, "").data?.entries ?? [];
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [value, setValue] = useState("");
  const [uploads, setUploads] = useState<Transfer[]>([]);
  const [over, setOver] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  const [conflict, setConflict] = useState<{
    path: string;
    answer: (replace: boolean) => void;
  } | null>(null);

  if (!project.folderPath)
    return (
      <section aria-labelledby="files" className="mt-6">
        <h2 id="files" className="mb-2 text-base font-semibold">
          {t("projects:detail.files")}
        </h2>
        <p className="text-muted">{t("projects:list.noFolder")}</p>
      </section>
    );

  const errorText = (e: unknown) =>
    e instanceof ApiError && e.code === "path_exists"
      ? t("projects:files.exists")
      : e instanceof ApiError && e.code === "file_too_large"
        ? t("projects:files.tooLarge")
        : t("projects:files.error");

  const send = async (path: string, file: File, replace: boolean): Promise<void> => {
    const key = ++seq.current;
    setUploads((u) => [...u, { key, name: path, fraction: 0 }]);
    const progress = (fraction: number) =>
      setUploads((u) => u.map((x) => (x.key === key ? { ...x, fraction } : x)));
    try {
      await uploadProjectFile(id, path, file, replace, progress);
    } catch (e) {
      // An existing name never gets replaced silently: ask first.
      if (e instanceof ApiError && e.code === "path_exists" && !replace) {
        setUploads((u) => u.filter((x) => x.key !== key));
        const yes = await new Promise<boolean>((answer) => setConflict({ path, answer }));
        if (yes) return send(path, file, true);
      } else setFailed(`${path}: ${errorText(e)}`);
    } finally {
      setUploads((u) => u.filter((x) => x.key !== key));
    }
  };
  const onFiles = async (dir: string, files: FileList | File[]) => {
    setFailed(null);
    for (const f of Array.from(files)) await send(join(dir, f.name), f, false);
    actions.done();
  };
  const onReplace = async (path: string, file: File) => {
    setFailed(null);
    await send(path, file, true);
    actions.done();
  };

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
    <section
      aria-labelledby="files"
      className={`mt-6 rounded-lg ${over ? "outline outline-2 outline-accent" : ""}`}
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
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h2 id="files" className="text-base font-semibold">
          {t("projects:detail.files")}
        </h2>
        <div className="flex gap-2">
          <Button onClick={() => picker.current?.click()}>
            <Upload className="size-4" aria-hidden />
            {t("projects:files.upload")}
          </Button>
          <Button onClick={() => open({ kind: "folder", dir: "" })}>
            <FolderPlus className="size-4" aria-hidden />
            {t("projects:files.newFolder")}
          </Button>
        </div>
        <FilePick inputRef={picker} multiple onFiles={(f) => onFiles("", f)} />
      </div>
      <p className="mb-2 text-muted">{t("projects:files.dropHint")}</p>
      {uploads.length > 0 && (
        <ul className="mb-2 grid gap-2" aria-live="polite">
          {uploads.map((u) => (
            <li
              key={u.key}
              className="flex flex-col gap-1 rounded-md border border-border bg-surface-2 p-2"
            >
              <span className="break-all">{t("projects:files.uploading", { name: u.name })}</span>
              <progress
                className="h-2 w-full accent-[var(--accent)]"
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
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <label className="mr-auto flex min-h-9 items-center gap-2">
          <input
            type="checkbox"
            className="size-5 accent-[var(--accent)]"
            checked={allSelected}
            disabled={!top.length}
            onChange={toggleAll}
          />
          {t("projects:files.selectAll")}
        </label>
        <span className="text-muted" aria-live="polite">
          {t("projects:files.selected", { count: picked.length })}
        </span>
        <Button disabled={!picked.length} onClick={() => open({ kind: "bulkMove", paths: picked })}>
          <FolderInput className="size-4" aria-hidden />
          {t("projects:files.bulkMove")}
        </Button>
        <Button
          disabled={!picked.length}
          onClick={() => open({ kind: "bulkDelete", paths: picked })}
        >
          <Trash2 className="size-4" aria-hidden />
          {t("projects:files.bulkDelete")}
        </Button>
      </div>
      <div className="rounded-lg border border-border bg-surface">
        <Children
          path=""
          depth={0}
          ctx={{ projectId: id, onFiles, onReplace, ask: open, selected, toggle }}
        />
      </div>
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
      <ConfirmDialog
        open={!!conflict}
        title={t("projects:files.replaceTitle")}
        description={t("projects:files.replaceHint", { name: conflict?.path ?? "" })}
        confirmLabel={t("projects:files.replaceAction")}
        destructive
        onConfirm={() => {
          conflict?.answer(true);
          setConflict(null);
        }}
        onCancel={() => {
          conflict?.answer(false);
          setConflict(null);
        }}
      />
    </section>
  );
}
