import { SLICER_ZIP_TYPES } from "@3d-maker-suite/core";
import { Link, useNavigate, useParams } from "@tanstack/react-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { FormField, inputClass } from "../../components/FormField.tsx";
import { PageHeader } from "../../components/PageHeader.tsx";
import { useZipSources, useZipUpload } from "../../lib/slicerCatalog.ts";

// i18n keys are written out in full so `pnpm i18n:check` can see them.
const TYPES = {
  brands: "integrations:capabilities.brands",
  printerModels: "integrations:capabilities.printerModels",
  machineProfiles: "integrations:capabilities.machineProfiles",
  filamentBrands: "integrations:capabilities.filamentBrands",
  filamentProfiles: "integrations:capabilities.filamentProfiles",
} as const;
const ERRORS: Record<string, string> = {
  invalid_zip: "import:zip.errors.invalid_zip",
  not_slicer_folder: "import:zip.errors.not_slicer_folder",
  zip_too_large: "import:zip.errors.zip_too_large",
};

/** Upload a zip of a slicer's config folder (for a server with no slicer on it), then review per type. */
export function SlicerZipPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { id } = useParams({ strict: false }) as { id?: string };
  const sources = useZipSources();
  const [picked, setPicked] = useState("");
  const source = sources.data?.find((s) => s.id === picked) ?? sources.data?.[0];
  const upload = useZipUpload(source?.id ?? "");
  const name = source ? t(`filament:library.sources.${source.id}`) : "";

  return (
    <>
      <PageHeader title={t("import:zip.title")} description={t("import:zip.description")} />
      <div className="grid max-w-3xl gap-5">
        {source && (
          <>
            <FormField label={t("import:zip.slicer")}>
              {(p) => (
                <select
                  {...p}
                  className={inputClass}
                  value={source.id}
                  onChange={(e) => setPicked(e.target.value)}
                >
                  {sources.data?.map((s) => (
                    <option key={s.id} value={s.id}>
                      {t(`filament:library.sources.${s.id}`)}
                    </option>
                  ))}
                </select>
              )}
            </FormField>
            <ol className="grid list-decimal gap-2 pl-5">
              <li>{t("import:zip.steps.open", { name })}</li>
              <li>
                {t("import:zip.steps.folder")}
                <ul className="list-disc pl-5 text-muted">
                  <li>{t("import:zip.steps.windows", { folder: source.folders.windows })}</li>
                  <li>{t("import:zip.steps.mac", { folder: source.folders.mac })}</li>
                  <li>{t("import:zip.steps.linux", { folder: source.folders.linux })}</li>
                </ul>
              </li>
              <li>{t("import:zip.steps.select")}</li>
              <li>{t("import:zip.steps.zip")}</li>
              <li>{t("import:zip.steps.upload")}</li>
            </ol>
            <label className="inline-flex h-9 w-fit cursor-pointer items-center rounded-md bg-accent px-3 font-medium text-accent-fg hover:opacity-90 focus-within:outline focus-within:outline-2">
              {t("import:zip.choose")}
              <input
                type="file"
                accept=".zip,application/zip"
                className="sr-only"
                disabled={upload.isPending}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file)
                    upload.mutate(file, {
                      onSuccess: (uploadId) =>
                        navigate({ to: "/import/slicer-zip/$id", params: { id: uploadId } }),
                    });
                  e.target.value = "";
                }}
              />
            </label>
            {upload.isPending && <p role="status">{t("import:zip.reading")}</p>}
            {upload.isError && (
              <p role="alert" className="text-bad">
                {t(ERRORS[upload.error.message] ?? "import:zip.errors.error")}
              </p>
            )}
          </>
        )}
        {sources.data && !source && <p className="text-muted">{t("import:zip.none")}</p>}

        {id && (
          <section className="grid gap-2">
            <h2 className="font-medium">{t("import:zip.review")}</h2>
            <ul className="grid gap-1">
              {SLICER_ZIP_TYPES.map((type) => (
                <li key={type}>
                  <Link
                    to="/slicer-zip/$id/$type"
                    params={{ id, type }}
                    className="font-medium underline"
                  >
                    {t(TYPES[type])}
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </>
  );
}
