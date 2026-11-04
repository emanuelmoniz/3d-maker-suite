import type { Integration, SyncPolicy } from "@3d-maker-suite/core";
import { Link } from "@tanstack/react-router";
import { TriangleAlert } from "lucide-react";
import { useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "../../components/Button.tsx";
import { inputClass } from "../../components/FormField.tsx";
import { Switch } from "../../components/Switch.tsx";
import { cx } from "../../lib/cx.ts";
import { formatNumber } from "../../lib/format.ts";
import { useCatalogBrands, useImportBrands, usePatchIntegration } from "../../lib/integrations.ts";
import { CAPS } from "./integrationLabels.ts";

const SIDES = {
  brands: "integrations:catalog.brands",
  filamentBrands: "integrations:catalog.filamentBrands",
};

/**
 * A slicer's catalog (brands, models, machine, print and filament profiles) as one row: pick the
 * brands you use, then keep it to what you have. The seven stored policies change together.
 */
export function CatalogRow({
  integration: i,
  policies,
}: {
  integration: Integration;
  policies: SyncPolicy[];
}) {
  const { t } = useTranslation();
  const patch = usePatchIntegration(i.id);
  const [picking, setPicking] = useState(false);
  const only = policies.every((p) => p.scope === "imported");
  const pending = policies.reduce(
    (n, p) => n + (i.capabilities.includes(p.type) ? p.pending : 0),
    0,
  );
  const scopeAll = (scope: "all" | "imported") =>
    patch.mutateAsync({ policies: policies.map((p) => ({ type: p.type, scope })) });

  return (
    <li className="grid gap-3 px-3 py-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <div className="min-w-0 flex-1">
          <p className="font-medium">{t("integrations:catalog.title")}</p>
          <p className="text-muted">
            {only
              ? t("integrations:policies.scopes.imported")
              : t("integrations:policies.scopes.all")}
          </p>
        </div>
        {pending > 0 && (
          <span className="flex items-center gap-1 font-medium text-warn">
            <TriangleAlert aria-hidden className="size-4 shrink-0" />
            {t("integrations:policies.pending", { count: pending })}
          </span>
        )}
        <Button aria-expanded={picking} onClick={() => setPicking(!picking)}>
          {t("integrations:catalog.chooseBrands")}
        </Button>
      </div>

      {picking && (
        <BrandPicker
          integration={i}
          onDone={() => setPicking(false)}
          onlyHave={() => scopeAll("imported")}
        />
      )}

      <div className="grid gap-1">
        <Switch
          label={t("integrations:policies.scopes.imported")}
          checked={only}
          disabled={patch.isPending}
          onChange={(e) => scopeAll(e.target.checked ? "imported" : "all")}
        />
        <p className="text-muted">
          {only ? t("integrations:catalog.onlyHint") : t("integrations:catalog.allHint")}
        </p>
        {patch.isError && (
          <p role="alert" className="text-bad">
            {t("integrations:card.actionError")}
          </p>
        )}
      </div>

      {/* The review of each type stays: it is where the changes of an update wait. */}
      <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-muted">
        {t("integrations:catalog.review")}
        {policies
          .filter((p) => i.capabilities.includes(p.type))
          .map((p) => (
            <Link
              key={p.type}
              to="/import/$source/$id/$type"
              params={{ source: "integration", id: i.id, type: p.type }}
              className={cx("underline", p.pending > 0 && "font-medium text-warn")}
            >
              {t(CAPS[p.type])}
              {p.pending > 0 && ` (${formatNumber(p.pending)})`}
            </Link>
          ))}
      </p>
    </li>
  );
}

/** Two checklists, printer brands and filament brands; the ones you have are checked already. */
function BrandPicker({
  integration: i,
  onDone,
  onlyHave,
}: {
  integration: Integration;
  onDone: () => void;
  onlyHave: () => Promise<unknown>;
}) {
  const { t } = useTranslation();
  const { data, isError } = useCatalogBrands(i.id, true);
  const add = useImportBrands(i.id);
  const search = useId();
  const [filter, setFilter] = useState("");
  const [picked, setPicked] = useState({
    brands: new Set<string>(),
    filamentBrands: new Set<string>(),
  });
  const count = picked.brands.size + picked.filamentBrands.size;
  const toggle = (side: keyof typeof picked, name: string) =>
    setPicked((p) => {
      const next = new Set(p[side]);
      if (!next.delete(name)) next.add(name);
      return { ...p, [side]: next };
    });
  const submit = async () => {
    await add.mutateAsync({
      brands: [...picked.brands],
      filamentBrands: [...picked.filamentBrands],
    });
    // A pick is "the brands I use": from now on only what you have is kept up to date.
    await onlyHave();
    onDone();
  };
  const match = (name: string) => name.toLowerCase().includes(filter.trim().toLowerCase());

  return (
    <div className="grid gap-3 rounded-md bg-surface-2 p-4">
      <p className="text-muted">{t("integrations:catalog.pickHint")}</p>
      <div className="grid gap-1">
        <label htmlFor={search} className="font-medium">
          {t("integrations:catalog.search")}
        </label>
        <input
          id={search}
          type="search"
          className={inputClass}
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
      </div>
      {isError && (
        <p role="alert" className="text-bad">
          {t("integrations:catalog.readError")}
        </p>
      )}
      {data && (
        <div className="grid gap-4 @2xl:grid-cols-2">
          {(["brands", "filamentBrands"] as const).map((side) => (
            <fieldset key={side} className="grid content-start gap-1">
              <legend className="mb-1 font-semibold">{t(SIDES[side])}</legend>
              <div className="grid max-h-64 gap-0.5 overflow-y-auto">
                {data[side]
                  .filter((b) => match(b.name))
                  .map((b) => (
                    <label key={b.name} className="flex min-h-9 items-center gap-2">
                      <input
                        type="checkbox"
                        checked={b.have || picked[side].has(b.name)}
                        disabled={b.have || add.isPending}
                        onChange={() => toggle(side, b.name)}
                      />
                      {b.name}
                      {b.have && (
                        <span className="text-muted">{t("integrations:catalog.have")}</span>
                      )}
                    </label>
                  ))}
              </div>
            </fieldset>
          ))}
        </div>
      )}
      {add.isError && (
        <p role="alert" className="text-bad">
          {t("integrations:card.actionError")}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <Button variant="primary" disabled={!count || add.isPending} onClick={submit}>
          {t("integrations:catalog.import", { count })}
        </Button>
        <Button variant="ghost" disabled={add.isPending} onClick={onDone}>
          {t("integrations:catalog.cancel")}
        </Button>
      </div>
    </div>
  );
}
