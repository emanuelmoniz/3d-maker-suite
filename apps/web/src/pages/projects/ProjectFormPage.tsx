import { type Project, type ProjectDetail, ROOT_HUB } from "@3d-maker-suite/core";
import { useNavigate, useParams } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "../../components/Button.tsx";
import { Collapsible } from "../../components/Collapsible.tsx";
import { Combobox } from "../../components/Combobox.tsx";
import { FormField, inputClass } from "../../components/FormField.tsx";
import { PageHeader } from "../../components/PageHeader.tsx";
import { PathPicker } from "../../components/PathPicker.tsx";
import { useMe } from "../../lib/auth.ts";
import { isConflict } from "../../lib/catalog.ts";
import { uploadProjectFile } from "../../lib/projectFiles.ts";
import {
  galleryImages,
  useCreateProject,
  usePatchProject,
  useProject,
} from "../../lib/projects.ts";
import { useRoots } from "../../lib/roots.ts";
import { useUsers } from "../../lib/users.ts";
import { DescriptionEditor, type DescriptionState } from "./DescriptionEditor.tsx";
import { GalleryPicker } from "./GalleryPicker.tsx";
import { FolderActions } from "./ProjectFolder.tsx";
import { SlicingSetup, useSlicingDraft } from "./SlicingSetup.tsx";

const text = (f: FormData, k: string) => String(f.get(k) ?? "").trim();

/** A collapsible card on the edit page; on the add page the fields just sit on it. */
function Section({
  title,
  edit,
  wide,
  children,
}: {
  title: string;
  edit: boolean;
  wide?: boolean;
  children: React.ReactNode;
}) {
  const fields = <div className={`grid gap-4${wide ? "" : " sm:max-w-md"}`}>{children}</div>;
  return edit ? (
    <Collapsible title={title} className="">
      {fields}
    </Collapsible>
  ) : (
    fields
  );
}

function ProjectForm({ project }: { project?: ProjectDetail }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const create = useCreateProject();
  const patch = usePatchProject(project?.id ?? "");
  const save = project ? patch : create;
  const setup = useSlicingDraft(project?.id ?? "");
  const [setupFailed, setSetupFailed] = useState(false);
  // Deep link from the project page: the form mounts after its data loads, too late for the browser's jump.
  useEffect(() => {
    if (location.hash === "#slicing") document.getElementById("slicing")?.scrollIntoView();
  }, []);
  const [folder, setFolder] = useState("");
  // Only roots the user may change files in (ADR-0014).
  const allRoots = useRoots();
  const roots = allRoots.filter((r) => r.canEdit);
  // An admin picks the owner, except in a device root: its device's user owns it.
  const pickOwner =
    useMe()?.role === "admin" &&
    !!project &&
    !allRoots.some((r) => r.id === project.rootId && r.location !== ROOT_HUB);
  const users = useUsers(pickOwner).data ?? [];
  const [ownerId, setOwnerId] = useState(project?.owner?.id ?? "");
  // Blank folder path + a root: make the folder there (the first root unless picked).
  const [rootId, setRootId] = useState<string>();
  const createIn = project || folder.trim() ? "" : (rootId ?? roots[0]?.id ?? "");
  // Without a working folder (none, unlinked and kept, or missing) its files can't be picked or
  // written: what the project knows of them waits for the folder.
  const ok = project?.folderState === "ok";
  const [description, setDescription] = useState<DescriptionState>({
    link: (ok && project?.descriptionFile) || "",
    text: project?.description ?? "",
    original: project?.description ?? "",
  });
  const [writeFailed, setWriteFailed] = useState(false);
  const files = ok ? (project?.meta.files ?? []) : [];
  const models = files.filter((f) => f.kind === "model");
  const initialPreview = project?.editedFields.includes("filePath")
    ? (models.find((m) => m.path === project.filePath)?.path ?? "")
    : "";
  const [preview, setPreview] = useState(initialPreview);
  // Offline, a device project's picker has only what the hub keeps: the gallery's images it got.
  const images =
    project?.folderState === "offline"
      ? galleryImages(project).filter((f) => !project.galleryLeftOut.includes(f.path))
      : files.filter((f) => f.kind === "image");
  // The picker works on single images: folder picks saved by an older version become their images.
  const [gallery, setGallery] = useState(() =>
    project ? galleryImages(project).map((f) => f.path) : [],
  );
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
      if (ok && file !== project.descriptionFile) changed.descriptionFile = file;
      if (preview !== initialPreview) changed.previewFile = preview || null;
      if (JSON.stringify(gallery) !== JSON.stringify(galleryImages(project).map((f) => f.path)))
        changed.gallery = { folders: [], images: gallery };
      if ((cover || null) !== project.coverFile) changed.coverFile = cover || null;
      if (pickOwner && ownerId !== (project.owner?.id ?? "")) changed.ownerId = ownerId || null;
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
      // The print setup is saved with the rest, even if it was never sliced.
      try {
        await setup.flush();
        setSetupFailed(false);
      } catch {
        return setSetupFailed(true);
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
          ...(!folderPath && createIn ? { createFolder: true, rootId: createIn } : {}),
        },
        created,
      );
    }
  };

  return (
    <form onSubmit={onSubmit} className="grid gap-4">
      <Section title={t("projects:form.sectionDetails")} edit={!!project}>
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
            <input
              {...p}
              name="name"
              required
              className={inputClass}
              defaultValue={project?.name}
            />
          )}
        </FormField>
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
        {pickOwner && (
          <FormField label={t("projects:detail.ownerPick")}>
            {(p) => (
              <Combobox
                {...p}
                value={ownerId}
                onChange={setOwnerId}
                options={[
                  ...users
                    .filter((u) => !u.disabled)
                    .map((u) => ({ value: u.id, label: u.displayName })),
                  { value: "", label: t("projects:detail.noOwner") },
                ]}
              />
            )}
          </FormField>
        )}
        {!project && (
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
                onChange={setRootId}
                options={[
                  ...roots.map((r) => ({ value: r.id, label: r.path })),
                  { value: "", label: t("projects:form.createInNone") },
                ]}
              />
            )}
          </FormField>
        )}
      </Section>
      {project && (
        <Section title={t("projects:folder.title")} edit>
          {project.folderPath ? (
            <FormField
              label={t("projects:form.folder")}
              hint={
                project.folderState === "missing"
                  ? t("projects:folder.missingTitle")
                  : t("projects:form.editedHint")
              }
            >
              {(p) => (
                <input {...p} readOnly className={inputClass} value={project.folderPath ?? ""} />
              )}
            </FormField>
          ) : (
            !project.unlinkedFolder && <p className="text-muted">{t("projects:folder.none")}</p>
          )}
          <FolderActions project={project} />
        </Section>
      )}
      <Section title={t("projects:form.sectionDescription")} edit={!!project} wide>
        <DescriptionEditor project={project} value={description} onChange={setDescription} />
      </Section>
      {(models.length > 0 || (project?.folderPath && images.length > 0)) && (
        <Section title={t("projects:form.sectionImages")} edit={!!project} wide>
          {models.length > 0 && (
            <div className="sm:max-w-md">
              <FormField
                label={t("projects:form.previewFile")}
                hint={t("projects:form.previewFileHint")}
              >
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
            </div>
          )}
          {project?.folderPath && images.length > 0 && (
            <GalleryPicker
              project={project}
              images={images}
              value={gallery}
              cover={cover}
              onChange={setGallery}
              onCover={setCover}
            />
          )}
        </Section>
      )}
      {project && ok && (
        <Collapsible
          id="slicing"
          title={t("projects:slicing.title")}
          className=""
          defaultOpen={location.hash === "#slicing"}
        >
          <SlicingSetup project={project} setup={setup} />
        </Collapsible>
      )}
      {(save.isError || writeFailed || setupFailed) && (
        <p role="alert" className="text-bad">
          {t(
            save.isError && isConflict(save.error)
              ? "projects:form.numberTaken"
              : setupFailed
                ? "projects:slicing.saveFailed"
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
      {data && isFetchedAfterMount && <ProjectForm key={data.id} project={data} />}
    </>
  );
}
