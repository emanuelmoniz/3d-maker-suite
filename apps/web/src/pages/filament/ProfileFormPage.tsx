import type { FilamentProfile } from "@3d-maker-suite/core";
import { useNavigate, useParams } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { Button } from "../../components/Button.tsx";
import { FormField, inputClass } from "../../components/FormField.tsx";
import { PageHeader } from "../../components/PageHeader.tsx";
import { useCreateProfile, usePatchProfile, useProfile } from "../../lib/filament.ts";
import { usePreferences } from "../../lib/preferences.ts";

const text = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
const num = (v: string, scale = 1) => (v ? Math.round(Number(v) * scale) : null);
const float = (v: string) => (v ? Number(v) : null);

/** Create, or edit `profile`. */
function ProfileForm({ profile }: { profile?: FilamentProfile }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const currency = usePreferences().data?.values.currency ?? "";
  const create = useCreateProfile();
  const patch = usePatchProfile();
  const save = profile ? patch : create;
  const onSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = e.currentTarget;
    const f = new FormData(form);
    const values = {
      brand: text(f, "brand"),
      material: text(f, "material"),
      name: text(f, "name"),
      diameterMm: float(text(f, "diameter")) ?? 1.75,
      densityGcm3: Number(text(f, "density")),
      pricePerKg: num(text(f, "price"), 100),
      nozzleTempC: num(text(f, "nozzle")),
      bedTempC: num(text(f, "bed")),
    };
    if (profile)
      patch.mutate(
        { id: profile.id, patch: values },
        {
          onSuccess: () => navigate({ to: "/filament/profiles/$id", params: { id: profile.id } }),
        },
      );
    else create.mutate(values, { onSuccess: () => navigate({ to: "/filament" }) });
  };
  const field = (name: string, key: string, props: React.ComponentProps<"input"> = {}) => (
    <FormField label={t(key)}>
      {(p) => <input {...p} name={name} className={inputClass} {...props} />}
    </FormField>
  );
  return (
    <form onSubmit={onSubmit} className="grid gap-4 sm:max-w-md">
      {field("brand", "filament:profiles.brand", { defaultValue: profile?.brand })}
      {field("material", "filament:profiles.material", {
        required: true,
        defaultValue: profile?.material,
      })}
      {field("name", "filament:profiles.name", { defaultValue: profile?.name })}
      {field("diameter", "filament:profiles.diameter", {
        type: "number",
        min: 0.1,
        step: 0.01,
        defaultValue: profile?.diameterMm ?? 1.75,
      })}
      {field("density", "filament:profiles.density", {
        type: "number",
        required: true,
        min: 0.1,
        step: 0.01,
        defaultValue: profile?.densityGcm3 ?? 1.24,
      })}
      <FormField label={`${t("filament:profiles.pricePerKg")} (${currency})`}>
        {(p) => (
          <input
            {...p}
            name="price"
            type="number"
            min={0}
            step={0.01}
            defaultValue={profile?.pricePerKg == null ? undefined : profile.pricePerKg / 100}
            className={inputClass}
          />
        )}
      </FormField>
      {field("nozzle", "filament:profiles.nozzleTemp", {
        type: "number",
        min: 1,
        step: 1,
        defaultValue: profile?.nozzleTempC ?? undefined,
      })}
      {field("bed", "filament:profiles.bedTemp", {
        type: "number",
        min: 0,
        step: 1,
        defaultValue: profile?.bedTempC ?? undefined,
      })}
      {save.isError && (
        <p role="alert" className="text-bad">
          {t("filament:profiles.error")}
        </p>
      )}
      <div className="flex gap-2">
        <Button type="submit" variant="primary" disabled={save.isPending}>
          {t("filament:profiles.save")}
        </Button>
        <Button onClick={() => history.back()}>{t("common:actions.cancel")}</Button>
      </div>
    </form>
  );
}

export function ProfileCreatePage() {
  const { t } = useTranslation();
  return (
    <>
      <PageHeader title={t("filament:profiles.addTitle")} />
      <ProfileForm />
    </>
  );
}

export function ProfileEditPage() {
  const { t } = useTranslation();
  const { id } = useParams({ strict: false }) as { id: string };
  const { data } = useProfile(id);
  return (
    <>
      <PageHeader title={t("filament:profiles.editTitle")} />
      {/* key: the form is uncontrolled, so remount when the saved profile arrives */}
      {data && <ProfileForm key={data.updatedAt} profile={data} />}
    </>
  );
}
