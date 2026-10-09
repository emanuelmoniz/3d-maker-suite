import type { Project } from "@3d-maker-suite/core";
import { useNavigate, useParams } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { Button } from "../../components/Button.tsx";
import { FormField, inputClass } from "../../components/FormField.tsx";
import { PageHeader } from "../../components/PageHeader.tsx";
import { useCreateProject, usePatchProject, useProject } from "../../lib/projects.ts";

const text = (f: FormData, k: string) => String(f.get(k) ?? "").trim();

function ProjectForm({ project }: { project?: Project }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const create = useCreateProject();
  const patch = usePatchProject(project?.id ?? "");
  const save = project ? patch : create;

  const onSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const fields = {
      name: text(f, "name"),
      description: text(f, "description") || null,
      sourceUrl: text(f, "sourceUrl") || null,
    };
    // On edit only changed fields are sent: each one sent counts as "edited" and survives re-scans.
    const done = { onSuccess: () => navigate({ to: "/projects" }) };
    if (project)
      patch.mutate(
        Object.fromEntries(
          Object.entries(fields).filter(([k, v]) => v !== project[k as keyof typeof fields]),
        ),
        done,
      );
    else create.mutate({ ...fields, folderPath: text(f, "folderPath") || undefined }, done);
  };

  return (
    <form onSubmit={onSubmit} className="grid gap-4 sm:max-w-md">
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
            className={`${inputClass} h-28 py-2`}
            defaultValue={project?.description ?? ""}
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
          {(p) => <input {...p} name="folderPath" className={inputClass} />}
        </FormField>
      )}
      {save.isError && (
        <p role="alert" className="text-bad">
          {t("projects:form.error")}
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
