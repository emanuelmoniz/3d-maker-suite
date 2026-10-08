import { type FilamentProfile, SPOOL_STATUSES, type Spool } from "@3d-maker-suite/core";
import { useNavigate, useParams } from "@tanstack/react-router";
import { useTranslation } from "react-i18next";
import { Button } from "../../components/Button.tsx";
import { FormField, inputClass } from "../../components/FormField.tsx";
import { PageHeader } from "../../components/PageHeader.tsx";
import { TagPicker } from "../../components/TagPicker.tsx";
import {
  filamentLabel,
  useCreateSpool,
  usePatchSpool,
  useProfiles,
  useSpool,
} from "../../lib/filament.ts";
import { dateInputToIso, isoToDateInput } from "../../lib/format.ts";
import { useTagEditor } from "../../lib/tags.ts";
import { STATUS } from "./FilamentPage.tsx";

const text = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
const num = (v: string, scale = 1) => (v ? Math.round(Number(v) * scale) : null);
const float = (v: string) => (v ? Number(v) : null);

/** Create, or edit `spool`. The remaining weight only changes through "Adjust weight". */
function SpoolForm({ profiles, spool }: { profiles: FilamentProfile[]; spool?: Spool }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const create = useCreateSpool();
  const patch = usePatchSpool();
  const save = spool ? patch : create;
  const tags = useTagEditor("spool", spool?.id);
  const onSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = e.currentTarget;
    const f = new FormData(form);
    const date = (k: string) => (text(f, k) ? dateInputToIso(text(f, k)) : null);
    const values = {
      profileId: text(f, "profile"),
      colorHex: text(f, "color"),
      initialGrams: Number(text(f, "initial")),
      emptyWeightGrams: float(text(f, "empty")),
      pricePaid: num(text(f, "price"), 100),
      purchasedAt: date("purchasedAt"),
      openedAt: date("openedAt"),
      location: text(f, "location") || null,
    };
    const done = async (id: string) => {
      await tags.persist(id);
      navigate(spool ? { to: "/filament/spools/$id", params: { id } } : { to: "/filament" });
    };
    if (spool)
      patch.mutate(
        {
          id: spool.id,
          patch: { ...values, status: text(f, "status") as Spool["status"] },
        },
        { onSuccess: () => done(spool.id) },
      );
    else
      create.mutate(
        { ...values, remainingGrams: float(text(f, "remaining")) ?? undefined },
        { onSuccess: (saved) => done((saved as { id: string }).id) },
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
          <select
            {...p}
            name="profile"
            required
            defaultValue={spool?.profileId}
            className={inputClass}
          >
            {spool && !profiles.some((pr) => pr.id === spool.profileId) && (
              <option value={spool.profileId}>{t("filament:spools.archivedProfile")}</option>
            )}
            {profiles.map((pr) => (
              <option key={pr.id} value={pr.id}>
                {filamentLabel(pr)}
              </option>
            ))}
          </select>
        )}
      </FormField>
      <FormField label={t("filament:spools.color")}>
        {(p) => (
          <input
            {...p}
            name="color"
            type="color"
            defaultValue={spool?.colorHex ?? "#808080"}
            className={inputClass}
          />
        )}
      </FormField>
      {field("initial", "filament:spools.initial", {
        ...grams,
        required: true,
        defaultValue: spool?.initialGrams ?? 1000,
      })}
      {spool ? (
        <FormField label={t("filament:spools.status")}>
          {(p) => (
            <select {...p} name="status" defaultValue={spool.status} className={inputClass}>
              {SPOOL_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {t(STATUS[s])}
                </option>
              ))}
            </select>
          )}
        </FormField>
      ) : (
        field(
          "remaining",
          "filament:spools.remainingNow",
          grams,
          t("filament:spools.remainingHint"),
        )
      )}
      {field("empty", "filament:spools.emptyWeight", {
        ...grams,
        defaultValue: spool?.emptyWeightGrams ?? undefined,
      })}
      {field("price", "filament:spools.price", {
        type: "number",
        min: 0,
        step: 0.01,
        defaultValue: spool?.pricePaid == null ? undefined : spool.pricePaid / 100,
      })}
      {field("purchasedAt", "filament:spools.purchasedAt", {
        type: "date",
        defaultValue: isoToDateInput(spool?.purchasedAt ?? null),
      })}
      {field("openedAt", "filament:spools.openedAt", {
        type: "date",
        defaultValue: isoToDateInput(spool?.openedAt ?? null),
      })}
      {field("location", "filament:spools.locationLabel", {
        defaultValue: spool?.location ?? "",
      })}
      <TagPicker value={tags.value} onChange={tags.onChange} />
      {save.isError && (
        <p role="alert" className="text-bad">
          {t("filament:spools.error")}
        </p>
      )}
      <div className="flex gap-2">
        <Button type="submit" variant="primary" disabled={save.isPending || !profiles.length}>
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

export function SpoolEditPage() {
  const { t } = useTranslation();
  const { id } = useParams({ strict: false }) as { id: string };
  const profiles = useProfiles();
  const { data } = useSpool(id);
  return (
    <>
      <PageHeader title={t("filament:spools.editTitle")} />
      {/* key: the form is uncontrolled, so remount when the saved spool arrives */}
      {data && profiles.data && (
        <SpoolForm key={data.updatedAt} profiles={profiles.data.items} spool={data} />
      )}
    </>
  );
}
