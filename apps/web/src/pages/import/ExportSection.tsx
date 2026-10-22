import {
  IMPORT_ENTITIES,
  type ImportEntity,
  SHEET_FORMATS,
  type SheetFormat,
} from "@3d-maker-suite/core";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "../../components/Button.tsx";
import { Combobox } from "../../components/Combobox.tsx";
import { FormField } from "../../components/FormField.tsx";
import { useTemplate } from "../../lib/import.ts";
import { ENTITIES, templateBody } from "./entities.ts";

// i18n keys are written out in full so `pnpm i18n:check` can see them.
const FORMATS: Record<SheetFormat, string> = {
  xlsx: "import:formats.xlsx",
  csv: "import:formats.csv",
  json: "import:formats.json",
};

/** The format a template or an export is written as. */
export function FormatField({
  value,
  onChange,
}: {
  value: SheetFormat;
  onChange: (f: SheetFormat) => void;
}) {
  const { t } = useTranslation();
  return (
    <FormField label={t("import:formats.label")}>
      {(p) => (
        <Combobox
          {...p}
          value={value}
          onChange={(v) => onChange(v as SheetFormat)}
          options={SHEET_FORMATS.map((f) => ({ value: f, label: t(FORMATS[f]) }))}
        />
      )}
    </FormField>
  );
}

export function ExportSection() {
  const { t } = useTranslation();
  const [entity, setEntity] = useState<ImportEntity>("spools");
  const [format, setFormat] = useState<SheetFormat>("xlsx");
  const exportFile = useTemplate(entity, "export");
  const name = t(ENTITIES[entity].label);

  return (
    <section aria-labelledby="export-title" className="grid gap-4 border-t border-border pt-8">
      <h2 id="export-title" className="text-lg font-semibold">
        {t("import:exportAll.title")}
      </h2>
      <p className="text-muted">{t("import:exportAll.hint")}</p>

      <div className="grid gap-2 rounded-lg border border-border bg-surface p-4">
        <h3 className="font-medium">{t("import:exportAll.sheetTitle")}</h3>
        <p className="text-muted">{t("import:exportAll.sheetHint")}</p>
        <div className="flex flex-wrap items-end gap-3">
          <FormField label={t("import:exportAll.sheetWhat")}>
            {(p) => (
              <Combobox
                {...p}
                value={entity}
                onChange={(v) => setEntity(v as ImportEntity)}
                options={IMPORT_ENTITIES.map((e) => ({ value: e, label: t(ENTITIES[e].label) }))}
              />
            )}
          </FormField>
          <FormatField value={format} onChange={setFormat} />
          <Button
            disabled={exportFile.isPending}
            onClick={() =>
              exportFile.mutate({
                filename: t("import:export.filename", { name, ext: format }),
                body: templateBody(entity, t),
                format,
              })
            }
          >
            {t("import:export.download")}
          </Button>
        </div>
        {exportFile.isError && (
          <p role="alert" className="text-bad">
            {t("import:template.error")}
          </p>
        )}
      </div>
    </section>
  );
}
