import type { ImportEntity, ImportResult, SheetFormat } from "@3d-maker-suite/core";
import { Link } from "@tanstack/react-router";
import { type ReactNode, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "../../components/Button.tsx";
import { usePreview, useTemplate } from "../../lib/import.ts";
import { FormatField } from "./ExportSection.tsx";
import { ENTITIES, templateBody } from "./entities.ts";
import { ReviewTable } from "./ReviewTable.tsx";

/**
 * Template, upload and review of one entity. Import | Export puts its type picker in `picker`
 * (and keys the flow by type); Catalog opens it for a fixed type.
 */
export function ImportFlow({ entity, picker }: { entity: ImportEntity; picker?: ReactNode }) {
  const { t } = useTranslation();
  const [done, setDone] = useState<ImportResult | null>(null);
  const [format, setFormat] = useState<SheetFormat>("xlsx");
  const template = useTemplate(entity);
  const preview = usePreview(entity);
  const body = templateBody(entity, t);
  const name = t(ENTITIES[entity].label);

  return (
    <>
      <div className="grid gap-4 rounded-lg border border-border bg-surface p-4">
        <div className="grid gap-2">
          <h3 className="font-medium">{t("import:import.step1")}</h3>
          <div className="flex flex-wrap items-end gap-3">
            {picker}
            <FormatField value={format} onChange={setFormat} />
            <Button
              disabled={template.isPending}
              onClick={() =>
                template.mutate({
                  filename: t("import:template.filename", { name, ext: format }),
                  body,
                  format,
                })
              }
            >
              {t("import:template.download")}
            </Button>
          </div>
          <p className="text-muted">{t("import:import.step1Hint")}</p>
        </div>

        <div className="grid gap-2 border-t border-border pt-4">
          <h3 className="font-medium">{t("import:import.step2")}</h3>
          <label className="inline-flex h-9 w-fit cursor-pointer items-center whitespace-nowrap rounded-md bg-accent px-3 font-medium text-accent-fg hover:opacity-90 focus-within:outline-2">
            {t("import:upload.choose")}
            <input
              type="file"
              accept=".xlsx,.csv,.json"
              className="sr-only"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) {
                  setDone(null);
                  preview.mutate({ file, labels: body.labels });
                }
                e.target.value = "";
              }}
            />
          </label>
          <p className="text-muted">{t("import:upload.hint")}</p>
        </div>
      </div>

      {(preview.isError || template.isError) && (
        <p role="alert" className="text-bad">
          {t(preview.isError ? "import:upload.error" : "import:template.error")}
        </p>
      )}
      {done && (
        <p role="status" className="font-medium text-ok">
          {t("import:done.summary", { created: done.created, updated: done.updated })}{" "}
          <Link to={ENTITIES[entity].to} className="underline">
            {t(ENTITIES[entity].view)}
          </Link>
        </p>
      )}
      {preview.data && (
        <ReviewTable
          key={preview.data.uploadId}
          entity={entity}
          preview={preview.data}
          onCancel={() => preview.reset()}
          onDone={(result) => {
            setDone(result);
            preview.reset();
          }}
        />
      )}
    </>
  );
}
