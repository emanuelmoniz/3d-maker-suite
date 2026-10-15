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
import { useCreateProject, usePatchProject, useProject } from "../../lib/projects.ts";

const text = (f: FormData, k: string) => String(f.get(k) ?? "").trim();

function ProjectForm({ project }: { project?: Project }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const create = useCreateProject();
  const patch = usePatchProject(project?.id ?? "");
  const save = project ? patch : create;
  const [folder, setFolder] = useState("");
  const [link, setLink] = useState(project?.descriptionFile ?? "");
  const docs = (project?.meta.files ?? []).filter(
    (f) => f.kind === "doc" && !/.pdf$/i.test(f.path),
  );

  const onSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const number = text(f, "number") ? Number(text(f, "number")) : undefined;
    const fields = {
      number,
      name: text(f, "name"),
      description: text(f, "description") || null,
      sourceUrl: text(f, "sourceUrl") || null,
    };
    const link = text(f, "descriptionFile") || null;
    // On edit only changed fields are sent: each one sent counts as "edited" and survives re-scans.
    const done = { onSuccess: () => navigate({ to: "/projects" }) };
    if (project) {
      const changed: Record<string, unknown> = Object.fromEntries(
        Object.entries(fields).filter(([k, v]) => v !== project[k as keyof typeof fields]),
      );
      // A linked file supplies the text, so the (disabled) textarea is not sent.
      if (link) delete changed.description;
      if (link !== project.descriptionFile) changed.descriptionFile = link;
      patch.mutate(changed, done);
    } else {
      // Blank means "let the scan decide": only what was typed is sent, so it is not "edited".
      const typed = Object.fromEntries(Object.entries(fields).filter(([, v]) => v));
      create.mutate(
        { ...typed, name: fields.name, folderPath: text(f, "folderPath") || undefined },
        done,
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
            name="description"
            disabled={!!link}
            className={`${inputClass} h-28 py-2`}
            defaultValue={project?.description ?? ""}
          />
        )}
      </FormField>
      {project?.folderPath && docs.length > 0 && (
        <FormField
          label={t("projects:form.descriptionFile")}
          hint={t("projects:form.descriptionFileHint")}
        >
          {(p) => (
            <Combobox
              {...p}
              name="descriptionFile"
              value={link}
              onChange={setLink}
              options={[
                { value: "", label: t("projects:form.descriptionFileNone") },
                ...docs.map((d) => ({ value: d.path, label: d.path })),
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
      {save.isError && (
        <p role="alert" className="text-bad">
          {t(isConflict(save.error) ? "projects:form.numberTaken" : "projects:form.error")}
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
