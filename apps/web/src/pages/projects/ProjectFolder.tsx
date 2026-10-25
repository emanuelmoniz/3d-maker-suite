import {
  PROJECT_TRASH_DIR,
  type ProjectDetail,
  type ProjectFolderRelease,
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
import { usePreferences } from "../../lib/preferences.ts";
import { useProjectFolder } from "../../lib/projects.ts";

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

/** The two ways to let go of a folder, with what each means when unlinking or switching. */
const RELEASE = {
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
 * a working folder asks what happens to it: the trash, or kept as it is.
 */
export function FolderActions({ project }: { project: ProjectDetail }) {
  const { t } = useTranslation();
  const id = useId();
  const roots = usePreferences().data?.values.projectRoots.map((r) => r.path) ?? [];
  const folder = useProjectFolder(project.id);
  // Open while asking: `path` set = switch to that folder, else unlink.
  const [pending, setPending] = useState<{ path?: string } | null>(null);
  const [how, setHow] = useState<ProjectFolderRelease>("keep");
  const [root, setRoot] = useState<string>();
  const ok = project.folderState === "ok";
  const old = project.folderPath ? roots.find((r) => within(project.folderPath ?? "", r)) : null;
  const chosen = root ?? old ?? roots[0] ?? "";
  const code = folder.error instanceof ApiError ? folder.error.code : undefined;
  const sep = project.folderPath?.includes("\\") ? "\\" : "/";
  // Only a folder inside a root has a trash to go to.
  const trash = old ? `${old.replace(/[\\/]+$/, "")}${sep}${PROJECT_TRASH_DIR}` : null;
  const choices = ok ? (["trash", "keep"] as const).filter((v) => v === "keep" || trash) : [];
  const trashedTo = folder.isSuccess ? folder.data.trashedTo : undefined;
  const mode = pending?.path ? "change" : "unlink";
  const link = "font-medium text-accent hover:underline";
  const ask = (next: { path?: string }) => {
    setHow("keep");
    setPending(next);
  };
  return (
    <div className="grid gap-3">
      {!project.folderPath && project.unlinkedFolder && (
        <div className="grid gap-2">
          <p className="wrap-break-word text-muted">
            {t("projects:folder.kept", { path: project.unlinkedFolder })}
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
          <Write admin>
            <PathPicker
              label={t("projects:folder.linkTitle")}
              mode="folder"
              initial={old ?? undefined}
              within={roots}
              onPick={(path) => ask({ path })}
            >
              {t("projects:folder.change")}
            </PathPicker>
          </Write>
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
                onChange={setRoot}
                options={roots.map((r) => ({ value: r, label: r }))}
              />
            )}
            <Button disabled={folder.isPending} onClick={() => folder.mutate({ root: chosen })}>
              {t(project.folderState ? "projects:folder.recreate" : "projects:folder.create")}
            </Button>
            <Write admin>
              <PathPicker
                label={t("projects:folder.linkTitle")}
                mode="folder"
                initial={old ?? undefined}
                within={roots}
                onPick={(path) => folder.mutate({ path })}
              >
                {t(project.folderState ? "projects:folder.linkOther" : "projects:folder.link")}
              </PathPicker>
            </Write>
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
            values={{ path: trashedTo }}
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
                from: project.folderPath,
                to: pending?.path,
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
            pending.path ? { path: pending.path, previous: how } : { unlink: ok ? how : "trash" },
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
                    {t(RELEASE[v][mode], { trash })}
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
        {t("projects:folder.missingText", { path: project.folderPath })}
      </p>
      <FolderActions project={project} />
    </section>
  );
}
