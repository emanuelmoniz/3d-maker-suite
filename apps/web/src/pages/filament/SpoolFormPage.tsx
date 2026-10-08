import type { FilamentProfile } from "@3d-maker-suite/core";
import { useNavigate } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { Button } from "../../components/Button.tsx";
import { FormField, inputClass } from "../../components/FormField.tsx";
import { PageHeader } from "../../components/PageHeader.tsx";
import { filamentLabel, useCreateSpool, useProfiles } from "../../lib/filament.ts";
import { dateInputToIso } from "../../lib/format.ts";

const text = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
const num = (v: string, scale = 1) => (v ? Math.round(Number(v) * scale) : null);
const float = (v: string) => (v ? Number(v) : null);

function SpoolForm({ profiles }: { profiles: FilamentProfile[] }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const create = useCreateSpool();
  const onSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = e.currentTarget;
    const f = new FormData(form);
    const date = (k: string) => (text(f, k) ? dateInputToIso(text(f, k)) : null);
    create.mutate(
      {
        profileId: text(f, "profile"),
        initialGrams: Number(text(f, "initial")),
        remainingGrams: float(text(f, "remaining")) ?? undefined,
        emptyWeightGrams: float(text(f, "empty")),
        pricePaid: num(text(f, "price"), 100),
        purchasedAt: date("purchasedAt"),
        openedAt: date("openedAt"),
        location: text(f, "location") || null,
      },
      { onSuccess: () => navigate({ to: "/filament" }) },
    );
  };
  const field = (
    name: string,
    key: string,
    props: React.ComponentProps<"input"> = {},
    hint?: string,
  ) => (
    <FormField label={t(key)} hint={hint}>
      {(p) => <input {...p} name={name} className={inputClass} {...props} />}
    </FormField>
  );
  const grams = { type: "number", min: 0, step: 0.1 } as const;
  return (
    <form onSubmit={onSubmit} className="grid gap-4 sm:max-w-md">
      <FormField label={t("filament:spools.profile")}>
        {(p) => (
          <select {...p} name="profile" required className={inputClass}>
            {profiles.map((pr) => (
              <option key={pr.id} value={pr.id}>
                {filamentLabel(pr)}
              </option>
            ))}
          </select>
        )}
      </FormField>
      {field("initial", "filament:spools.initial", {
        ...grams,
        required: true,
        defaultValue: 1000,
      })}
      {field(
        "remaining",
        "filament:spools.remainingNow",
        grams,
        t("filament:spools.remainingHint"),
      )}
      {field("empty", "filament:spools.emptyWeight", grams)}
      {field("price", "filament:spools.price", { type: "number", min: 0, step: 0.01 })}
      {field("purchasedAt", "filament:spools.purchasedAt", { type: "date" })}
      {field("openedAt", "filament:spools.openedAt", { type: "date" })}
      {field("location", "filament:spools.locationLabel")}
      {create.isError && (
        <p role="alert" className="text-bad">
          {t("filament:spools.error")}
        </p>
      )}
      <div className="flex gap-2">
        <Button type="submit" variant="primary" disabled={create.isPending || !profiles.length}>
          {t("filament:spools.save")}
        </Button>
        <Button onClick={() => history.back()}>{t("common:actions.cancel")}</Button>
      </div>
    </form>
  );
}

export function SpoolCreatePage() {
  const { t } = useTranslation();
  const profiles = useProfiles();
  return (
    <>
      <PageHeader title={t("filament:spools.addTitle")} />
      <SpoolForm profiles={profiles.data?.items ?? []} />
    </>
  );
}
