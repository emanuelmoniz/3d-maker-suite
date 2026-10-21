import type { Project } from "@3d-maker-suite/core";
import { useNavigate, useParams } from "@tanstack/react-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "../../components/Button.tsx";
import { Combobox } from "../../components/Combobox.tsx";
import { FormField, inputClass } from "../../components/FormField.tsx";
import { Markdown } from "../../components/Markdown.tsx";
import { PageHeader } from "../../components/PageHeader.tsx";
import { PathPicker } from "../../components/PathPicker.tsx";
import { isConflict } from "../../lib/catalog.ts";
import { usePreferences } from "../../lib/preferences.ts";
import { uploadProjectFile } from "../../lib/projectFiles.ts";
import { useCreateProject, usePatchProject, useProject } from "../../lib/projects.ts";

const text = (f: FormData, k: string) => String(f.get(k) ?? "").trim();

function ProjectForm({ project }: { project?: Project }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const create = useCreateProject();
  const patch = usePatchProject(project?.id ?? "");
  const save = project ? patch : create;
  const [folder, setFolder] = useState("");
  const roots = usePreferences().data?.values.projectRoots ?? [];
  // Blank folder path + a root: make the folder there (the first root unless picked).
  const [root, setRoot] = useState<string>();
  const createIn = project || folder.trim() ? "" : (root ?? roots[0] ?? "");
  const saved = project?.descriptionFile ?? "";
  const [link, setLink] = useState(saved);
  const [desc, setDesc] = useState(project?.description ?? "");
  const [writeFailed, setWriteFailed] = useState(false);
  const files = project?.meta.files ?? [];
  const mdDocs = files.filter((f) => f.kind === "doc" && /\.md$/i.test(f.path)).map((f) => f.path);
  // The saved link stays pickable even if it is not .md; README.md is made on save when new.
  const docPaths = [...new Set([...(saved ? [saved] : []), ...mdDocs])];
  const isNewFile = !!link && !docPaths.includes(link);
  // Picking another existing file shows its text only after saving, so don't edit (or write) it now.
  const loading = !!link && link !== saved && !isNewFile;
  const models = files.filter((f) => f.kind === "model");
  const initialPreview = project?.editedFields.includes("filePath")
    ? (models.find((m) => project.filePath?.replaceAll("\\", "/").endsWith(`/${m.path}`))?.path ??
      "")
    : "";
  const [preview, setPreview] = useState(initialPreview);

  const onSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const number = text(f, "number") ? Number(text(f, "number")) : undefined;
    const fields = {
      number,
      name: text(f, "name"),
      description: desc.trim() || null,
      sourceUrl: text(f, "sourceUrl") || null,
    };
    // A new file is only made when there is text for it.
    const file = isNewFile && !desc.trim() ? null : link || null;
    // On edit only changed fields are sent: each one sent counts as "edited" and survives re-scans.
    const done = {
      onSuccess: () => navigate({ to: "/projects/$id", params: { id: project?.id ?? "" } }),
    };
    const created = {
      onSuccess: (p: Project) =>
        p.folderPath
          ? navigate({ to: "/projects/$id", params: { id: p.id } })
          : navigate({ to: "/projects" }),
    };
    if (project) {
      const changed: Record<string, unknown> = Object.fromEntries(
        Object.entries(fields).filter(([k, v]) => v !== project[k as keyof typeof fields]),
      );
      // A linked file supplies the text: editing it writes the file instead of the description.
      if (file) delete changed.description;
      if (file !== project.descriptionFile) changed.descriptionFile = file;
      if (preview !== initialPreview) changed.previewFile = preview || null;
      const write = file && !loading && (isNewFile || desc.trim() !== (project.description ?? ""));
      if (write) {
        try {
          // Replaces an existing file; the server re-scans, so the description follows.
          await uploadProjectFile(project.id, file, new File([desc], file), !isNewFile, () => {});
        } catch {
          return setWriteFailed(true);
        }
        setWriteFailed(false);
      }
      patch.mutate(changed, done);
    } else {
      // Blank means "let the scan decide": only what was typed is sent, so it is not "edited".
      const typed = Object.fromEntries(Object.entries(fields).filter(([, v]) => v));
      const folderPath = text(f, "folderPath") || undefined;
      create.mutate(
        {
          ...typed,
          name: fields.name,
          folderPath,
          ...(!folderPath && createIn ? { createFolder: true, root: createIn } : {}),
        },
        created,
      );
    }
  };

  return (
    <form onSubmit={onSubmit} className="grid gap-4 sm:max-w-md">
      <FormField
        label={t("projects:form.number")}
        hint={project ? undefined : t("projects:form.numberHint")}
      >
        {(p) => (
          <input
            {...p}
            name="number"
            type="number"
            min={1}
            step={1}
            className={inputClass}
            defaultValue={project?.number}
          />
        )}
      </FormField>
      <FormField label={t("projects:form.name")}>
        {(p) => (
          <input {...p} name="name" required className={inputClass} defaultValue={project?.name} />
        )}
      </FormField>
      <FormField label={t("projects:form.description")}>
        {(p) => (
          <textarea
            {...p}
            disabled={loading}
            className={`${inputClass} h-40 py-2 font-mono`}
            value={loading ? "" : desc}
            onChange={(e) => setDesc(e.target.value)}
          />
        )}
      </FormField>
      {link.toLowerCase().endsWith(".md") && !loading && desc.trim() && (
        <section aria-label={t("projects:form.descriptionPreview")}>
          <h2 className="mb-1 text-muted">{t("projects:form.descriptionPreview")}</h2>
          <div className="rounded-md border border-border p-3">
            <Markdown>{desc}</Markdown>
          </div>
        </section>
      )}
      {project?.folderPath && (
        <FormField
          label={t("projects:form.descriptionFile")}
          hint={t("projects:form.descriptionFileHint")}
        >
          {(p) => (
            <Combobox
              {...p}
              value={link}
              onChange={setLink}
              options={[
                { value: "", label: t("projects:form.descriptionFileNone") },
                ...docPaths.map((d) => ({ value: d, label: d })),
                ...(docPaths.includes("README.md")
                  ? []
                  : [
                      {
                        value: "README.md",
                        label: t("projects:form.descriptionFileNew", { name: "README.md" }),
                      },
                    ]),
              ]}
            />
          )}
        </FormField>
      )}
      {models.length > 0 && (
        <FormField label={t("projects:form.previewFile")} hint={t("projects:form.previewFileHint")}>
          {(p) => (
            <Combobox
              {...p}
              value={preview}
              onChange={setPreview}
              options={[
                { value: "", label: t("projects:form.previewFileAuto") },
                ...models.map((m) => ({ value: m.path, label: m.path })),
              ]}
            />
          )}
        </FormField>
      )}
      <FormField label={t("projects:form.sourceUrl")} hint={t("projects:form.sourceUrlHint")}>
        {(p) => (
          <input
            {...p}
            name="sourceUrl"
            type="url"
            className={inputClass}
            defaultValue={project?.sourceUrl ?? ""}
          />
        )}
      </FormField>
      {project ? (
        project.folderPath && (
          <FormField label={t("projects:form.folder")} hint={t("projects:form.editedHint")}>
            {(p) => (
              <input {...p} readOnly className={inputClass} value={project.folderPath ?? ""} />
            )}
          </FormField>
        )
      ) : (
        <FormField label={t("projects:form.folder")} hint={t("projects:form.folderHint")}>
          {(p) => (
            <div className="flex gap-2">
              <input
                {...p}
                name="folderPath"
                className={inputClass}
                value={folder}
                onChange={(e) => setFolder(e.target.value)}
              />
              <PathPicker
                label={t("projects:form.folder")}
                mode="folder"
                initial={folder}
                onPick={setFolder}
              />
            </div>
          )}
        </FormField>
      )}
      {!project && !folder.trim() && roots.length > 0 && (
        <FormField label={t("projects:form.createIn")} hint={t("projects:form.createInHint")}>
          {(p) => (
            <Combobox
              {...p}
              value={createIn}
              onChange={setRoot}
              options={[
                ...roots.map((r) => ({ value: r, label: r })),
                { value: "", label: t("projects:form.createInNone") },
              ]}
            />
          )}
        </FormField>
      )}
      {(save.isError || writeFailed) && (
        <p role="alert" className="text-bad">
          {t(
            save.isError && isConflict(save.error)
              ? "projects:form.numberTaken"
              : writeFailed
                ? "projects:form.writeError"
                : "projects:form.error",
          )}
        </p>
      )}
      <div className="flex gap-2">
        <Button type="submit" variant="primary" disabled={save.isPending}>
          {t("projects:form.save")}
        </Button>
        <Button onClick={() => history.back()}>{t("common:actions.cancel")}</Button>
      </div>
    </form>
  );
}

export function ProjectCreatePage() {
  const { t } = useTranslation();
  return (
    <>
      <PageHeader title={t("projects:form.addTitle")} backTo={{ to: "/projects" }} />
      <ProjectForm />
    </>
  );
}

export function ProjectEditPage() {
  const { t } = useTranslation();
  const { id } = useParams({ strict: false }) as { id: string };
  const { data } = useProject(id);
  return (
    <>
      <PageHeader
        title={t("projects:form.editTitle")}
        backTo={{ to: "/projects/$id", params: { id } }}
      />
      {/* key: the form is uncontrolled, so remount when the saved project arrives */}
      {data && <ProjectForm key={data.updatedAt} project={data} />}
    </>
  );
}
