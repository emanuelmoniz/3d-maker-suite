import type { Project } from "@3d-maker-suite/core";
import { useNavigate, useParams } from "@tanstack/react-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "../../components/Button.tsx";
import { Combobox } from "../../components/Combobox.tsx";
import { FormField, inputClass } from "../../components/FormField.tsx";
import { PageHeader } from "../../components/PageHeader.tsx";
import { PathPicker } from "../../components/PathPicker.tsx";
import { isConflict } from "../../lib/catalog.ts";
import { usePreferences } from "../../lib/preferences.ts";
import { uploadProjectFile } from "../../lib/projectFiles.ts";
import { useCreateProject, usePatchProject, useProject } from "../../lib/projects.ts";
import { DescriptionEditor, type DescriptionState } from "./DescriptionEditor.tsx";
import { GalleryPicker } from "./GalleryPicker.tsx";
import { SlicingSetup } from "./SlicingSetup.tsx";

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
  const [description, setDescription] = useState<DescriptionState>({
    link: project?.descriptionFile ?? "",
    text: project?.description ?? "",
    original: project?.description ?? "",
  });
  const [writeFailed, setWriteFailed] = useState(false);
  const files = project?.meta.files ?? [];
  const models = files.filter((f) => f.kind === "model");
  const initialPreview = project?.editedFields.includes("filePath")
    ? (models.find((m) => project.filePath?.replaceAll("\\", "/").endsWith(`/${m.path}`))?.path ??
      "")
    : "";
  const [preview, setPreview] = useState(initialPreview);
  const images = files.filter((f) => f.kind === "image");
  const [gallery, setGallery] = useState(project?.gallery ?? { folders: [], images: [] });
  const [cover, setCover] = useState(project?.coverFile ?? "");

  const onSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const number = text(f, "number") ? Number(text(f, "number")) : undefined;
    const fields = {
      number,
      name: text(f, "name"),
      description: description.text.trim() || null,
      sourceUrl: text(f, "sourceUrl") || null,
    };
    const file = description.link || null;
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
      if (JSON.stringify(gallery) !== JSON.stringify(project.gallery)) changed.gallery = gallery;
      if ((cover || null) !== project.coverFile) changed.coverFile = cover || null;
      if (file && description.text !== description.original) {
        try {
          // Replaces the file; the server re-scans, so the description follows.
          const name = file.split("/").pop() ?? file;
          await uploadProjectFile(
            project.id,
            file,
            new File([description.text], name),
            true,
            () => {},
          );
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
    <form onSubmit={onSubmit} className="grid gap-4 sm:*:max-w-md">
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
      <DescriptionEditor project={project} value={description} onChange={setDescription} />
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
      {project?.folderPath && images.length > 0 && (
        <>
          <GalleryPicker project={project} value={gallery} onChange={setGallery} />
          <FormField label={t("projects:form.cover")} hint={t("projects:form.coverHint")}>
            {(p) => (
              <Combobox
                {...p}
                value={cover}
                onChange={setCover}
                options={[
                  { value: "", label: t("projects:form.coverAuto") },
                  ...images.map((f) => ({ value: f.path, label: f.path })),
                ]}
              />
            )}
          </FormField>
        </>
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
  const { data, isFetchedAfterMount } = useProject(id);
  return (
    <>
      <PageHeader
        title={t("projects:form.editTitle")}
        backTo={{ to: "/projects/$id", params: { id } }}
      />
      {/* Waits for fresh data: the form keeps its own state, and a background re-scan (e.g. after
          "New file…") must not reset what was typed. */}
      {data && isFetchedAfterMount && (
        <>
          <ProjectForm key={data.id} project={data} />
          <SlicingSetup project={data} />
        </>
      )}
    </>
  );
}
