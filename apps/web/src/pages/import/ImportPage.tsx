import type { ImportEntity } from "@3d-maker-suite/core";
import { Link } from "@tanstack/react-router";
import { useState } from "react";
import { Trans, useTranslation } from "react-i18next";
import { Combobox } from "../../components/Combobox.tsx";
import { FormField } from "../../components/FormField.tsx";
import { PageHeader } from "../../components/PageHeader.tsx";
import { mutedLink } from "../../lib/cx.ts";
import { ExportSection } from "./ExportSection.tsx";
import { ENTITIES, SHEET_ENTITIES } from "./entities.ts";
import { ImportFlow } from "./ImportFlow.tsx";

export function ImportPage() {
  const { t } = useTranslation();
  const [entity, setEntity] = useState<ImportEntity>("spools");

  return (
    <>
      <PageHeader title={t("import:title")} description={t("import:description")} />
      <div className="grid gap-8">
        <section aria-labelledby="import-title" className="grid gap-4">
          <h2 id="import-title" className="text-lg font-semibold">
            {t("import:import.title")}
          </h2>
          <p className="text-muted">{t("import:import.hint")}</p>
          <p className="text-muted">
            <Trans
              i18nKey="import:catalogMoved"
              components={{ link: <Link to="/catalog/printers" className={mutedLink} /> }}
            />
          </p>

          <ImportFlow
            key={entity}
            entity={entity}
            picker={
              <FormField label={t("import:entity")}>
                {(p) => (
                  <Combobox
                    {...p}
                    value={entity}
                    onChange={(v) => setEntity(v as ImportEntity)}
                    options={SHEET_ENTITIES.map((e) => ({
                      value: e,
                      label: t(ENTITIES[e].label),
                    }))}
                  />
                )}
              </FormField>
            }
          />

          <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border p-4">
            <div className="min-w-0 flex-1 basis-64">
              <h3 className="font-medium">{t("import:zip.cardTitle")}</h3>
              <p className="text-muted">{t("import:zip.cardHint")}</p>
            </div>
            {/* The zip lives with what fills the catalog (ADR-0020). */}
            <Link
              to="/catalog/settings/sources"
              className="inline-flex h-9 items-center rounded-md border border-border bg-surface px-3 font-medium hover:bg-surface-2"
            >
              {t("import:zip.toSources")}
            </Link>
          </div>
        </section>

        <ExportSection />
      </div>
    </>
  );
}
