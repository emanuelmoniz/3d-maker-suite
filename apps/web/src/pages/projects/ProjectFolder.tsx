import type { ProjectDetail } from "@3d-maker-suite/core";
import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { Trans, useTranslation } from "react-i18next";
import { Button } from "../../components/Button.tsx";
import { Combobox } from "../../components/Combobox.tsx";
import { ConfirmDialog } from "../../components/ConfirmDialog.tsx";
import { PathPicker } from "../../components/PathPicker.tsx";
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

/**
 * Create / link / unlink a project's folder. Create and link only while it has no working folder
 * (none, or missing); create defaults to the root the missing folder was in.
 */
export function FolderActions({ project }: { project: ProjectDetail }) {
  const { t } = useTranslation();
  const roots = usePreferences().data?.values.projectRoots.map((r) => r.path) ?? [];
  const folder = useProjectFolder(project.id);
  const [confirm, setConfirm] = useState(false);
  const [root, setRoot] = useState<string>();
  const old = project.folderPath ? roots.find((r) => within(project.folderPath ?? "", r)) : null;
  const chosen = root ?? old ?? roots[0] ?? "";
  const code = folder.error instanceof ApiError ? folder.error.code : undefined;
  const link = "font-medium text-accent hover:underline";
  return (
    <div className="grid gap-3">
      {project.folderState !== "ok" &&
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
            <PathPicker
              label={t("projects:folder.linkTitle")}
              mode="folder"
              initial={old ?? undefined}
              within={roots}
              onPick={(path) => folder.mutate({ path })}
            >
              {t(project.folderState ? "projects:folder.linkOther" : "projects:folder.link")}
            </PathPicker>
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
      {project.folderPath && (
        <div>
          <Button variant="danger" disabled={folder.isPending} onClick={() => setConfirm(true)}>
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
      <ConfirmDialog
        open={confirm}
        title={t("projects:folder.unlinkTitle")}
        description={t("projects:folder.unlinkText")}
        confirmLabel={t("projects:folder.unlink")}
        destructive
        onCancel={() => setConfirm(false)}
        onConfirm={() => {
          setConfirm(false);
          folder.mutate(null);
        }}
      />
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
      <p className="break-all text-muted">
        {t("projects:folder.missingText", { path: project.folderPath })}
      </p>
      <FolderActions project={project} />
    </section>
  );
}
