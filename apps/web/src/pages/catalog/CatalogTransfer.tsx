import { type ImportEntity, SHEET_FORMATS, type SheetFormat } from "@3d-maker-suite/core";
import { Link } from "@tanstack/react-router";
import { Download, Upload } from "lucide-react";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Write } from "../../components/Write.tsx";
import { useTemplate } from "../../lib/import.ts";
import { ENTITIES, templateBody } from "../import/entities.ts";

const btn =
  "inline-flex h-9 items-center gap-2 whitespace-nowrap border border-border bg-surface px-3 font-medium hover:bg-surface-2";

/** Import and Export of one catalog table, next to its Add button. */
export function CatalogTransfer({ entity }: { entity: ImportEntity }) {
  const { t } = useTranslation();
  const [format, setFormat] = useState<SheetFormat>("csv");
  const exportFile = useTemplate(entity, "export");
  const name = t(ENTITIES[entity].label);

  return (
    <>
      <Write can="catalog" level="manage">
        <Link to="/catalog/import/$entity" params={{ entity }} className={`${btn} rounded-md`}>
          <Upload className="size-4" aria-hidden />
          {t("catalog:transfer.import")}
        </Link>
      </Write>
      <span className="inline-flex">
        <button
          type="button"
          disabled={exportFile.isPending}
          className={`${btn} rounded-l-md disabled:opacity-60`}
          onClick={() =>
            exportFile.mutate({
              filename: t("import:export.filename", { name, ext: format }),
              body: templateBody(entity, t),
              format,
            })
          }
        >
          <Download className="size-4" aria-hidden />
          {t("catalog:transfer.export")}
        </button>
        <select
          aria-label={t("catalog:transfer.format", { name })}
          value={format}
          onChange={(e) => setFormat(e.target.value as SheetFormat)}
          className="-ml-px h-9 rounded-r-md border border-border bg-surface px-2 text-muted hover:bg-surface-2"
        >
          {SHEET_FORMATS.map((f) => (
            <option key={f} value={f}>
              {f}
            </option>
          ))}
        </select>
      </span>
      {exportFile.isError && (
        <span role="alert" className="text-bad">
          {t("import:template.error")}
        </span>
      )}
    </>
  );
}
