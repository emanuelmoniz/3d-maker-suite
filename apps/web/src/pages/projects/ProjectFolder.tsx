import {
  PROJECT_TRASH_DIR,
  type ProjectDetail,
  type ProjectFolderPrevious,
  ROOT_HUB,
} from "@3d-maker-suite/core";
import { Link } from "@tanstack/react-router";
import { useId, useState } from "react";
import { Trans, useTranslation } from "react-i18next";
import { Button } from "../../components/Button.tsx";
import { Combobox } from "../../components/Combobox.tsx";
import { ConfirmDialog } from "../../components/ConfirmDialog.tsx";
import { PathPicker } from "../../components/PathPicker.tsx";
import { Write } from "../../components/Write.tsx";
import { ApiError } from "../../lib/api.ts";
import { useProjectFolder, useProjectFolderHasFiles } from "../../lib/projects.ts";
import { useRoots } from "../../lib/roots.ts";

const ERRORS = {
  outside_roots: "projects:folder.errors.outside_roots",
  folder_in_use: "projects:folder.errors.folder_in_use",
  folder_exists: "projects:folder.errors.folder_exists",
  invalid_folder: "projects:folder.errors.invalid_folder",
} as const;

const within = (path: string, root: string) => {
  const parts = (p: string) => p.toLowerCase().split(/[\\/]/).filter(Boolean);
  const r = parts(root);
  return parts(path).slice(0, r.length).join("/") === r.join("/");
};

/** `path` from its root's own name down ("projects\test2"); the way to the root stays out of it. */
const fromRoot = (path: string | null | undefined, roots: string[]) => {
  if (!path) return path;
  const root = roots.find((r) => within(path, r));
  if (!root) return path;
  const cut = root.replace(/[\\/]+$/, "");
  const start = Math.max(cut.lastIndexOf("/"), cut.lastIndexOf("\\")) + 1;
  return path.slice(start);
};

/** The ways to let go of a folder, with what each means when unlinking or switching. */
const RELEASE = {
  move: {
    label: "projects:folder.moveLabel",
    unlink: "projects:folder.moveChangeHint",
    change: "projects:folder.moveChangeHint",
  },
  trash: {
    label: "projects:folder.trashLabel",
    unlink: "projects:folder.trashUnlinkHint",
    change: "projects:folder.trashChangeHint",
  },
  keep: {
    label: "projects:folder.keepLabel",
    unlink: "projects:folder.keepUnlinkHint",
    change: "projects:folder.keepChangeHint",
  },
} as const;

/**
 * Create / link / unlink / switch a project's folder. Create and link while it has no working
 * folder (none, or missing); create defaults to the root the missing folder was in. Letting go of
 * a working folder asks what happens to it: the trash, or kept as it is. A folder on a device is
 * created and trashed by its connector; the pickers browse this server only.
 */
export function FolderActions({ project }: { project: ProjectDetail }) {
  const { t } = useTranslation();
  const id = useId();
  const all = useRoots();
  const roots = all.map((r) => r.path);
  // Only roots the user may change files in (ADR-0014) are offered.
  const editable = all.filter((r) => r.canEdit);
  const hubRoots = editable.filter((r) => r.location === ROOT_HUB).map((r) => r.path);
  const onDevice = all.some((r) => r.id === project.rootId && r.location !== ROOT_HUB);
  const folder = useProjectFolder(project.id);
  // Open while asking: `path` set = switch to that folder, else unlink.
  const [pending, setPending] = useState<{ path?: string } | null>(null);
  const [how, setHow] = useState<ProjectFolderPrevious>("keep");
  const [rootId, setRootId] = useState<string>();
  const ok = project.folderState === "ok";
  const old = all.find((r) => r.id === project.rootId)?.path;
  const chosen =
    rootId ?? editable.find((r) => r.id === project.rootId)?.id ?? editable[0]?.id ?? "";
  const code = folder.error instanceof ApiError ? folder.error.code : undefined;
  const sep = project.folderPath?.includes("\\") ? "\\" : "/";
  // Only a folder inside a root has a trash to go to.
  const trash = old ? `${old.replace(/[\\/]+$/, "")}${sep}${PROJECT_TRASH_DIR}` : null;
  // "Move" is for switching, and only when there is something to move.
  const hasFiles = useProjectFolderHasFiles(project.id, !!pending?.path && ok);
  const choices = ok
    ? (["move", "trash", "keep"] as const).filter((v) =>
        v === "move" ? !!pending?.path && !!hasFiles && !!trash : v === "keep" || trash,
      )
    : [];
  const trashedTo = folder.isSuccess ? folder.data.trashedTo : undefined;
  const mode = pending?.path ? "change" : "unlink";
  const link = "font-medium text-accent hover:underline";
  const ask = (next: { path?: string }) => {
    setHow("keep");
    setPending(next);
  };
  // Its device isn't connected: nothing to do there until it is.
  if (project.folderState === "offline") return null;
  return (
    <div className="grid gap-3">
      {!project.folderPath && project.unlinkedFolder && (
        <div className="grid gap-2">
          <p className="wrap-break-word text-muted">
            {t("projects:folder.kept", { path: fromRoot(project.unlinkedFolder, roots) })}
          </p>
          <div>
            <Button
              disabled={folder.isPending}
              onClick={() => folder.mutate({ path: project.unlinkedFolder ?? "" })}
            >
              {t("projects:folder.relink")}
            </Button>
          </div>
        </div>
      )}
      {ok && (
        <div className="flex flex-wrap items-center gap-2">
          {!onDevice && (
            <PathPicker
              label={t("projects:folder.linkTitle")}
              mode="folder"
              canCreate
              initial={old}
              within={hubRoots}
              onPick={(path) => ask({ path })}
            >
              {t("projects:folder.change")}
            </PathPicker>
          )}
          <Button variant="danger" disabled={folder.isPending} onClick={() => ask({})}>
            {t("projects:folder.unlink")}
          </Button>
        </div>
      )}
      {!ok &&
        (roots.length ? (
          <div className="flex flex-wrap items-center gap-2">
            {roots.length > 1 && (
              <Combobox
                aria-label={t("projects:folder.root")}
                value={chosen}
                onChange={setRootId}
                options={editable.map((r) => ({ value: r.id, label: r.path }))}
              />
            )}
            <Button disabled={folder.isPending} onClick={() => folder.mutate({ rootId: chosen })}>
              {t(project.folderState ? "projects:folder.recreate" : "projects:folder.create")}
            </Button>
            {hubRoots.length > 0 && (
              <PathPicker
                label={t("projects:folder.linkTitle")}
                mode="folder"
                canCreate
                initial={onDevice ? undefined : old}
                within={hubRoots}
                onPick={(path) => folder.mutate({ path })}
              >
                {t(project.folderState ? "projects:folder.linkOther" : "projects:folder.link")}
              </PathPicker>
            )}
          </div>
        ) : (
          <p className="text-muted">
            <Trans
              t={t}
              i18nKey="projects:folder.noRoots"
              components={{ settings: <Link to="/projects/settings" className={link} /> }}
            />
          </p>
        ))}
      {project.folderState === "missing" && (
        <div>
          <Button variant="danger" disabled={folder.isPending} onClick={() => ask({})}>
            {t("projects:folder.unlink")}
          </Button>
        </div>
      )}
      {folder.isError && (
        <p role="alert" className="text-bad">
          {t(
            code && code in ERRORS ? ERRORS[code as keyof typeof ERRORS] : "projects:folder.error",
          )}
        </p>
      )}
      {trashedTo && (
        <p role="status" className="wrap-break-word text-muted">
          <Trans
            t={t}
            i18nKey="projects:folder.trashed"
            values={{ path: fromRoot(trashedTo, roots) }}
            components={{ settings: <Link to="/projects/settings" className={link} /> }}
          />
        </p>
      )}
      <ConfirmDialog
        open={!!pending}
        title={t(mode === "change" ? "projects:folder.changeTitle" : "projects:folder.unlinkTitle")}
        description={
          ok
            ? t(mode === "change" ? "projects:folder.changeText" : "projects:folder.unlinkText", {
                from: fromRoot(project.folderPath, roots),
                to: fromRoot(pending?.path, roots),
              })
            : t("projects:folder.unlinkMissingText")
        }
        confirmLabel={t(
          mode === "change" ? "projects:folder.changeConfirm" : "projects:folder.unlink",
        )}
        destructive={how === "trash" || !ok}
        onCancel={() => setPending(null)}
        onConfirm={() => {
          if (!pending) return;
          // A missing folder has nothing to move or keep: the project just forgets it.
          folder.mutate(
            pending.path
              ? { path: pending.path, previous: how }
              : { unlink: ok && how !== "move" ? how : "trash" },
          );
          setPending(null);
        }}
      >
        {choices.length > 0 && (
          <fieldset className="grid gap-2">
            <legend className="mb-1 font-medium">{t("projects:folder.releaseLegend")}</legend>
            {choices.map((v) => (
              <label
                key={v}
                className="flex cursor-pointer gap-3 rounded-md border border-border p-3 has-checked:border-accent"
              >
                <input
                  type="radio"
                  name={`${id}-release`}
                  className="mt-1"
                  checked={how === v}
                  onChange={() => setHow(v)}
                  aria-describedby={`${id}-${v}`}
                />
                <span className="grid gap-1">
                  <span className="font-medium">{t(RELEASE[v].label)}</span>
                  <span id={`${id}-${v}`} className="wrap-break-word text-muted text-sm">
                    {t(RELEASE[v][mode], { trash: fromRoot(trash, roots) })}
                  </span>
                </span>
              </label>
            ))}
          </fieldset>
        )}
      </ConfirmDialog>
    </div>
  );
}

/** On the project page while its folder is gone: what happened and how to fix it. */
export function MissingFolderBanner({ project }: { project: ProjectDetail }) {
  const { t } = useTranslation();
  const roots = useRoots().map((r) => r.path);
  if (project.folderState !== "missing") return null;
  return (
    <section
      role="alert"
      aria-labelledby="missing-folder"
      className="mb-4 grid gap-3 rounded-lg border border-warn bg-warn/10 p-4"
    >
      <h2 id="missing-folder" className="font-semibold">
        {t("projects:folder.missingTitle")}
      </h2>
      <p className="wrap-break-word text-muted">
        {t("projects:folder.missingText", { path: fromRoot(project.folderPath, roots) })}
      </p>
      <Write when={project.canEdit}>
        <FolderActions project={project} />
      </Write>
    </section>
  );
}
