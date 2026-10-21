import type { Project } from "@3d-maker-suite/core";
import { useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Combobox } from "../../components/Combobox.tsx";
import { ConfirmDialog } from "../../components/ConfirmDialog.tsx";
import { FormField, inputClass } from "../../components/FormField.tsx";
import { Markdown } from "../../components/Markdown.tsx";
import { isConflict } from "../../lib/catalog.ts";
import { cx } from "../../lib/cx.ts";
import { uploadProjectFile, useProjectFolders } from "../../lib/projectFiles.ts";
import { projectFileUrl } from "../../lib/projects.ts";

const NEW = "\u0000new";
const tab =
  "h-8 rounded-md border border-border px-3 aria-pressed:bg-surface-2 aria-pressed:font-medium";

export type DescriptionState = {
  /** Linked file ("" = none). */
  link: string;
  text: string;
  /** The file's text as loaded (or as created), so Save only writes it when it changed. */
  original: string;
};

/**
 * Markdown editor for the description, with the file it is kept in. Picking a file loads its text
 * right away; "New file…" creates one (with the text typed so far) and picks it.
 */
export function DescriptionEditor({
  project,
  value,
  onChange,
}: {
  project?: Project;
  value: DescriptionState;
  onChange: (v: DescriptionState) => void;
}) {
  const { t } = useTranslation();
  const editorId = useId();
  const [view, setView] = useState<"write" | "preview">("write");
  const [loading, setLoading] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const [created, setCreated] = useState<string[]>([]);
  const [asking, setAsking] = useState(false);
  const [name, setName] = useState("");
  const [folder, setFolder] = useState("");
  const [newError, setNewError] = useState<string | null>(null);
  const latest = useRef(0);
  const folders = useProjectFolders(project?.id ?? "", asking);

  const saved = project?.descriptionFile ?? "";
  const docs = (project?.meta.files ?? [])
    .filter((f) => f.kind === "doc" && /\.md$/i.test(f.path))
    .map((f) => f.path);
  // The saved link stays pickable even if it is not .md.
  const paths = [...new Set([...(saved ? [saved] : []), ...docs, ...created])];

  async function pick(path: string) {
    if (path === NEW) {
      setName(paths.some((p) => /^readme\.md$/i.test(p)) ? "description.md" : "README.md");
      setFolder("");
      setNewError(null);
      setAsking(true);
      return;
    }
    setLoadFailed(false);
    if (!path || !project) return onChange({ ...value, link: path });
    const ticket = ++latest.current;
    setLoading(true);
    try {
      const res = await fetch(projectFileUrl(project.id, path));
      if (!res.ok) throw new Error(String(res.status));
      const text = await res.text();
      if (ticket === latest.current) onChange({ link: path, text, original: text });
    } catch {
      if (ticket === latest.current) setLoadFailed(true);
    } finally {
      if (ticket === latest.current) setLoading(false);
    }
  }

  async function createFile() {
    if (!project) return;
    let file = name.trim();
    if (!file) return;
    if (!/\.md$/i.test(file)) file += ".md";
    const path = folder ? `${folder}/${file}` : file;
    try {
      await uploadProjectFile(project.id, path, new File([value.text], file), false, () => {});
    } catch (e) {
      return setNewError(
        t(isConflict(e) ? "projects:form.newFileExists" : "projects:form.writeError"),
      );
    }
    setCreated((c) => [...c, path]);
    onChange({ ...value, link: path, original: value.text });
    setAsking(false);
  }

  const plain = value.link.toLowerCase().endsWith(".txt");
  return (
    <div className="grid gap-4 sm:max-w-none!">
      {project?.folderPath && (
        <div className="sm:max-w-md">
          <FormField
            label={t("projects:form.descriptionFile")}
            hint={t("projects:form.descriptionFileHint")}
            error={loadFailed ? t("projects:form.descriptionLoadError") : undefined}
          >
            {(p) => (
              <Combobox
                {...p}
                value={value.link}
                onChange={pick}
                options={[
                  { value: "", label: t("projects:form.descriptionFileNone") },
                  ...paths.map((d) => ({ value: d, label: d })),
                  { value: NEW, label: t("projects:form.descriptionFileNewOption") },
                ]}
              />
            )}
          </FormField>
        </div>
      )}
      <div className="grid gap-1">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <label htmlFor={editorId} className="font-medium">
            {t("projects:form.description")}
          </label>
          {/* Side by side from lg up; tabs below that. */}
          <div className="flex gap-1 lg:hidden">
            <button
              type="button"
              className={tab}
              aria-pressed={view === "write"}
              onClick={() => setView("write")}
            >
              {t("projects:form.descriptionWrite")}
            </button>
            <button
              type="button"
              className={tab}
              aria-pressed={view === "preview"}
              onClick={() => setView("preview")}
            >
              {t("projects:form.descriptionPreview")}
            </button>
          </div>
        </div>
        <div className="grid gap-3 lg:grid-cols-2">
          <textarea
            id={editorId}
            disabled={loading}
            className={cx(
              inputClass,
              "h-96 resize-y py-2 font-mono",
              view === "preview" && "hidden lg:block",
            )}
            value={value.text}
            placeholder={loading ? t("projects:form.descriptionLoading") : undefined}
            onChange={(e) => onChange({ ...value, text: e.target.value })}
          />
          <div className={cx("relative min-h-96", view === "write" && "hidden lg:block")}>
            <section
              aria-label={t("projects:form.descriptionPreview")}
              className="h-96 overflow-auto rounded-md border border-border p-3 lg:absolute lg:inset-0 lg:h-auto"
            >
              {!value.text.trim() ? (
                <p className="text-muted">{t("projects:form.descriptionEmpty")}</p>
              ) : plain ? (
                <p className="whitespace-pre-line">{value.text}</p>
              ) : (
                <Markdown>{value.text}</Markdown>
              )}
            </section>
          </div>
        </div>
      </div>
      <ConfirmDialog
        open={asking}
        title={t("projects:form.newFileTitle")}
        description={t("projects:form.newFileHint")}
        confirmLabel={t("projects:form.newFileCreate")}
        onConfirm={createFile}
        onCancel={() => setAsking(false)}
      >
        <FormField label={t("projects:form.newFileName")} error={newError ?? undefined}>
          {(p) => (
            <input
              {...p}
              className={inputClass}
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key !== "Enter") return;
                e.preventDefault();
                void createFile();
              }}
            />
          )}
        </FormField>
        <FormField label={t("projects:form.newFileFolder")}>
          {(p) => (
            <Combobox
              {...p}
              value={folder}
              onChange={setFolder}
              options={[
                { value: "", label: t("projects:files.projectFolder") },
                ...(folders.data ?? []).map((f) => ({ value: f, label: f })),
              ]}
            />
          )}
        </FormField>
      </ConfirmDialog>
    </div>
  );
}
