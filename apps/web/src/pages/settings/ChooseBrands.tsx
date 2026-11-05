import { type Integration, SLICER_ZIP_TYPES } from "@3d-maker-suite/core";
import { useId, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "../../components/Button.tsx";
import { inputClass } from "../../components/FormField.tsx";
import { useCatalogBrands, useImportBrands, usePatchIntegration } from "../../lib/integrations.ts";

const SIDES = {
  brands: "integrations:catalog.brands",
  filamentBrands: "integrations:catalog.filamentBrands",
};
const SUMMARY = {
  brands: {
    all: "integrations:catalog.summary.brandsAll",
    more: "integrations:catalog.summary.brands",
  },
  filamentBrands: {
    all: "integrations:catalog.summary.filamentBrandsAll",
    more: "integrations:catalog.summary.filamentBrands",
  },
};
const SHOWN = 5;

/**
 * Pick the brands you use from what a slicer ships: they come with their models and system presets,
 * and from then on the seven types those are keep to what you have. Above the cards, because it
 * fills several of them at once.
 */
export function ChooseBrands({ integration: i }: { integration: Integration }) {
  const { t } = useTranslation();
  const patch = usePatchIntegration(i.id);
  const [picking, setPicking] = useState(false);
  const { data, isError } = useCatalogBrands(i.id, true);
  const onlyHave = () =>
    patch.mutateAsync({
      policies: i.policies
        .filter((p) => (SLICER_ZIP_TYPES as readonly string[]).includes(p.type))
        .map((p) => ({ type: p.type, scope: "imported" as const })),
    });

  return (
    <div className="grid gap-2">
      <div>
        <Button aria-expanded={picking} onClick={() => setPicking(!picking)}>
          {t("integrations:catalog.chooseBrands")}
        </Button>
      </div>
      {(["brands", "filamentBrands"] as const).map((side) => {
        const have = data?.[side].filter((b) => b.have).map((b) => b.name) ?? [];
        const names = have.slice(0, SHOWN);
        const count = have.length - names.length;
        return (
          have.length > 0 && (
            <p key={side} className="text-muted">
              {count ? t(SUMMARY[side].more, { names, count }) : t(SUMMARY[side].all, { names })}
            </p>
          )
        );
      })}
      {patch.isError && (
        <p role="alert" className="text-bad">
          {t("integrations:card.actionError")}
        </p>
      )}
      {picking && (
        <BrandPicker
          integration={i}
          data={data}
          isError={isError}
          onDone={() => setPicking(false)}
          onlyHave={onlyHave}
        />
      )}
    </div>
  );
}

type Brands = NonNullable<ReturnType<typeof useCatalogBrands>["data"]>;

/** Two checklists, printer brands and filament brands; the ones you have come first, locked. */
function BrandPicker({
  integration: i,
  data,
  isError,
  onDone,
  onlyHave,
}: {
  integration: Integration;
  data: Brands | undefined;
  isError: boolean;
  onDone: () => void;
  onlyHave: () => Promise<unknown>;
}) {
  const { t } = useTranslation();
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
  const setAll = (side: keyof typeof picked, names: string[], on: boolean) =>
    setPicked((p) => {
      const next = new Set(p[side]);
      for (const name of names) on ? next.add(name) : next.delete(name);
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
  const empty = !!data && !data.brands.length && !data.filamentBrands.length;

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
      {empty && (
        <p role="status" className="text-muted">
          {t("integrations:catalog.none")}
        </p>
      )}
      {data && !empty && (
        <div className="grid gap-4 @2xl:grid-cols-2">
          {(["brands", "filamentBrands"] as const).map((side) => {
            const shown = data[side].filter((b) => match(b.name));
            const have = shown.filter((b) => b.have);
            const open = shown.filter((b) => !b.have).map((b) => b.name);
            const on = open.filter((name) => picked[side].has(name)).length;
            return (
              <fieldset key={side} className="grid content-start gap-1">
                <legend className="mb-1 font-semibold">{t(SIDES[side])}</legend>
                <label className="flex min-h-9 items-center gap-2 font-medium">
                  <input
                    type="checkbox"
                    ref={(el) => {
                      if (el) el.indeterminate = on > 0 && on < open.length;
                    }}
                    checked={open.length > 0 && on === open.length}
                    disabled={!open.length || add.isPending}
                    onChange={(e) => setAll(side, open, e.target.checked)}
                  />
                  {t("integrations:catalog.selectAll")}
                </label>
                <div className="grid max-h-64 gap-0.5 overflow-y-auto">
                  {have.length > 0 && (
                    <>
                      <p className="mt-1 font-medium text-muted">
                        {t("integrations:catalog.inCatalog")}
                      </p>
                      {have.map((b) => (
                        <label key={b.name} className="flex min-h-9 items-center gap-2">
                          <input type="checkbox" checked disabled />
                          {b.name}
                        </label>
                      ))}
                    </>
                  )}
                  {open.length > 0 && have.length > 0 && (
                    <p className="mt-1 font-medium text-muted">
                      {t("integrations:catalog.available")}
                    </p>
                  )}
                  {open.map((name) => (
                    <label key={name} className="flex min-h-9 items-center gap-2">
                      <input
                        type="checkbox"
                        checked={picked[side].has(name)}
                        disabled={add.isPending}
                        onChange={() => toggle(side, name)}
                      />
                      {name}
                    </label>
                  ))}
                </div>
              </fieldset>
            );
          })}
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
