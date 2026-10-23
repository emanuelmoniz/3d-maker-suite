import { type FilamentProfile, SPOOL_STATUSES, type Spool } from "@3d-maker-suite/core";
import { useNavigate, useParams } from "@tanstack/react-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { AddDialog } from "../../components/AddDialog.tsx";
import { Button } from "../../components/Button.tsx";
import { Combobox } from "../../components/Combobox.tsx";
import { DateInput } from "../../components/DateInput.tsx";
import { FormField, inputClass } from "../../components/FormField.tsx";
import { PageHeader } from "../../components/PageHeader.tsx";
import { PickerWithAdd } from "../../components/PickerWithAdd.tsx";
import { TagPicker } from "../../components/TagPicker.tsx";
import { isConflict } from "../../lib/catalog.ts";
import {
  filamentLabel,
  useCreateSpool,
  usePatchSpool,
  useProfiles,
  useSpool,
} from "../../lib/filament.ts";
import { dateInputToIso, isoToDateInput } from "../../lib/format.ts";
import { usePreferences } from "../../lib/preferences.ts";
import { useTagEditor } from "../../lib/tags.ts";
import { STATUS } from "./FilamentPage.tsx";
import { ProfileForm } from "./ProfileFormPage.tsx";

const text = (f: FormData, k: string) => String(f.get(k) ?? "").trim();
const num = (v: string, scale = 1) => (v ? Math.round(Number(v) * scale) : null);
const float = (v: string) => (v ? Number(v) : null);

/**
 * Create, or edit `spool`. The remaining weight only changes through "Adjust weight". With
 * `onSaved` (a dialog) it hands the saved spool back instead of leaving the page.
 */
export function SpoolForm({
  profiles,
  spool,
  colorHex,
  profileId,
  openedAt,
  onSaved,
  onCancel = () => history.back(),
}: {
  profiles: FilamentProfile[];
  spool?: Spool;
  /** The new spool's colour, profile and opening day to start from. */
  colorHex?: string;
  profileId?: string;
  openedAt?: string;
  onSaved?: (spool: Spool) => void;
  onCancel?: () => void;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const create = useCreateSpool();
  const patch = usePatchSpool();
  const save = spool ? patch : create;
  const tags = useTagEditor("spool", spool?.id);
  const prefs = usePreferences().data?.values;
  const [pickedProfile, setPickedProfile] = useState(spool?.profileId ?? profileId);
  const [addProfile, setAddProfile] = useState(false);
  const onSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const form = e.currentTarget;
    const f = new FormData(form);
    const date = (k: string) => (text(f, k) ? dateInputToIso(text(f, k)) : null);
    const values = {
      profileId: text(f, "profile"),
      number: num(text(f, "number")) ?? undefined,
      colorHex: text(f, "color"),
      colorName: text(f, "colorName") || null,
      initialGrams: Number(text(f, "initial")),
      emptyWeightGrams: float(text(f, "empty")),
      lowGrams: float(text(f, "lowGrams")),
      // On is the default, so only "off" is stored.
      lowAlert: f.has("lowAlert") ? null : false,
      pricePaid: num(text(f, "price"), 100),
      purchasedAt: date("purchasedAt"),
      openedAt: date("openedAt"),
      location: text(f, "location") || null,
    };
    const done = async (saved: Spool) => {
      await tags.persist(saved.id);
      if (onSaved) return onSaved(saved);
      navigate(
        spool ? { to: "/filament/spools/$id", params: { id: saved.id } } : { to: "/filament" },
      );
    };
    if (spool)
      patch.mutate(
        {
          id: spool.id,
          patch: { ...values, status: text(f, "status") as Spool["status"] },
        },
        { onSuccess: (saved) => done(saved as Spool) },
      );
    else
      create.mutate(
        { ...values, remainingGrams: float(text(f, "remaining")) ?? undefined },
        { onSuccess: (saved) => done(saved as Spool) },
      );
  };
  const field = (
    name: string,
    key: string,
    props: React.ComponentProps<"input"> = {},
    hint?: string,
  ) => (
    <FormField label={t(key)} hint={hint}>
      {(p) =>
        props.type === "date" ? (
          <DateInput {...p} name={name} defaultValue={props.defaultValue as string} />
        ) : (
          <input {...p} name={name} className={inputClass} {...props} />
        )
      }
    </FormField>
  );
  const grams = { type: "number", min: 0, step: 0.01 } as const;
  return (
    <>
      <form onSubmit={onSubmit} className="grid gap-4 sm:max-w-md">
        {field(
          "number",
          "filament:spools.number",
          { type: "number", min: 1, step: 1, defaultValue: spool?.number },
          spool ? undefined : t("filament:spools.numberHint"),
        )}
        <FormField label={t("filament:spools.profile")}>
          {(p) => (
            <PickerWithAdd label={t("filament:profiles.add")} onAdd={() => setAddProfile(true)}>
              <Combobox
                // Remount once a new profile is listed, so defaultValue applies.
                key={profiles.length}
                {...p}
                name="profile"
                required
                defaultValue={pickedProfile}
                onChange={setPickedProfile}
                options={[
                  ...(spool && !profiles.some((pr) => pr.id === spool.profileId)
                    ? [{ value: spool.profileId, label: t("filament:spools.archivedProfile") }]
                    : []),
                  ...profiles.map((pr) => ({ value: pr.id, label: filamentLabel(pr) })),
                ]}
              />
            </PickerWithAdd>
          )}
        </FormField>
        <FormField label={t("filament:spools.color")}>
          {(p) => (
            <input
              {...p}
              name="color"
              type="color"
              defaultValue={spool?.colorHex ?? colorHex ?? "#808080"}
              className={inputClass}
            />
          )}
        </FormField>
        {field("colorName", "filament:spools.colorName", { defaultValue: spool?.colorName ?? "" })}
        {field("initial", "filament:spools.initial", {
          ...grams,
          required: true,
          defaultValue: spool?.initialGrams ?? 1000,
        })}
        {spool ? (
          <FormField label={t("filament:spools.status")}>
            {(p) => (
              <Combobox
                {...p}
                name="status"
                defaultValue={spool.status}
                options={SPOOL_STATUSES.map((s) => ({ value: s, label: t(STATUS[s]) }))}
              />
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
        {field(
          "lowGrams",
          "filament:spools.lowGrams",
          { ...grams, defaultValue: spool?.lowGrams ?? undefined },
          t("filament:spools.lowGramsHint", { grams: prefs?.lowSpoolGrams }),
        )}
        <label className="flex items-center gap-2">
          <input type="checkbox" name="lowAlert" defaultChecked={spool?.lowAlert !== false} />
          {t("filament:spools.lowAlert")}
        </label>
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
          defaultValue: isoToDateInput(spool?.openedAt ?? openedAt ?? null),
        })}
        {field("location", "filament:spools.locationLabel", {
          defaultValue: spool?.location ?? "",
        })}
        <TagPicker value={tags.value} onChange={tags.onChange} />
        {save.isError && (
          <p role="alert" className="text-bad">
            {t(isConflict(save.error) ? "filament:spools.numberTaken" : "filament:spools.error")}
          </p>
        )}
        <div className="flex gap-2">
          <Button type="submit" variant="primary" disabled={save.isPending || !profiles.length}>
            {t("filament:spools.save")}
          </Button>
          <Button onClick={onCancel}>{t("common:actions.cancel")}</Button>
        </div>
      </form>
      <AddDialog
        open={addProfile}
        title={t("filament:profiles.addTitle")}
        onClose={() => setAddProfile(false)}
      >
        <ProfileForm
          onCancel={() => setAddProfile(false)}
          onSaved={(pr) => {
            setPickedProfile(pr.id);
            setAddProfile(false);
          }}
        />
      </AddDialog>
    </>
  );
}

export function SpoolCreatePage() {
  const { t } = useTranslation();
  const profiles = useProfiles();
  return (
    <>
      <PageHeader title={t("filament:spools.addTitle")} backTo={{ to: "/filament" }} />
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
      <PageHeader
        title={t("filament:spools.editTitle")}
        backTo={{ to: "/filament/spools/$id", params: { id } }}
      />
      {/* key: the form is uncontrolled, so remount when the saved spool arrives */}
      {data && profiles.data && (
        <SpoolForm key={data.updatedAt} profiles={profiles.data.items} spool={data} />
      )}
    </>
  );
}
