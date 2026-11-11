import { Link } from "@tanstack/react-router";
import { Trans, useTranslation } from "react-i18next";
import { useZipSources } from "../../lib/slicerCatalog.ts";

/**
 * How presets arrive, under the preset tables. The zip steps are the ones of the zip page
 * (`import:zip.steps.*`); the zip link leads to each slicer's zip on Catalog settings → Preset sources.
 */
export function PresetsHint() {
  const { t } = useTranslation();
  const sources = useZipSources().data ?? [];
  return (
    <div className="grid gap-2 rounded-lg border border-border bg-surface p-4">
      <h3 className="font-medium">{t("catalog:arrive.title")}</h3>
      <p>
        <Trans
          i18nKey="catalog:arrive.body"
          components={{
            integrations: <Link to="/integrations" className="underline" />,
            zip: <Link to="/catalog/settings/preset-sources" className="underline" />,
          }}
        />
      </p>
      {sources.length > 0 && (
        <details>
          <summary className="min-h-9 w-fit cursor-pointer py-1.5 font-medium">
            {t("catalog:arrive.where")}
          </summary>
          <div className="grid gap-3 border-l-2 border-border pl-4">
            <p className="text-muted">{t("import:zip.steps.select")}</p>
            {sources.map((s) => (
              <div key={s.id}>
                <p className="font-medium">{t(`filament:library.sources.${s.id}`)}</p>
                <ul className="list-disc pl-5 text-muted">
                  <li>{t("import:zip.steps.windows", { folder: s.folders.windows })}</li>
                  <li>{t("import:zip.steps.mac", { folder: s.folders.mac })}</li>
                  <li>{t("import:zip.steps.linux", { folder: s.folders.linux })}</li>
                </ul>
              </div>
            ))}
            <p className="text-muted">{t("import:zip.steps.zip")}</p>
          </div>
        </details>
      )}
    </div>
  );
}
