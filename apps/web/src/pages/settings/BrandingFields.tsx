import { useTranslation } from "react-i18next";
import { Button } from "../../components/Button.tsx";
import { FormField, inputClass } from "../../components/FormField.tsx";
import { type BrandingKind, useBrandingUrl, useSaveBranding } from "../../lib/branding.ts";
import { usePreferences, useSavePreferences } from "../../lib/preferences.ts";
import { linkButton } from "../filament/SpoolDetailPage.tsx";

const KEYS = {
  logo: {
    label: "settings:branding.logo.label",
    hint: "settings:branding.logo.hint",
    alt: "settings:branding.logo.alt",
  },
  favicon: {
    label: "settings:branding.favicon.label",
    hint: "settings:branding.favicon.hint",
    alt: "settings:branding.favicon.alt",
  },
} as const;

function ImageField({ kind }: { kind: BrandingKind }) {
  const { t } = useTranslation();
  const url = useBrandingUrl(kind);
  const { upload, remove } = useSaveBranding(kind);
  return (
    <div className="grid gap-1.5">
      <span className="font-medium">{t(KEYS[kind].label)}</span>
      <p className="text-muted">{t(KEYS[kind].hint)}</p>
      <div className="flex flex-wrap items-center gap-2">
        {url && (
          <img
            src={url}
            alt={t(KEYS[kind].alt)}
            className="size-10 rounded-md border border-border object-contain"
          />
        )}
        <label
          className={`${linkButton} cursor-pointer focus-within:outline focus-within:outline-2`}
        >
          {t("settings:branding.upload")}
          <input
            type="file"
            accept="image/png,image/jpeg,image/webp"
            className="sr-only"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) upload.mutate(file);
              e.target.value = "";
            }}
          />
        </label>
        {url && (
          <Button variant="ghost" onClick={() => remove.mutate()}>
            {t("settings:branding.reset")}
          </Button>
        )}
      </div>
      {(upload.isError || remove.isError) && (
        <p role="alert" className="text-bad">
          {t("settings:branding.error")}
        </p>
      )}
    </div>
  );
}

/** Custom app name (empty = default), logo and favicon. */
export function BrandingFields() {
  const { t } = useTranslation();
  const name = usePreferences().data?.values.appName ?? "";
  const save = useSavePreferences();
  return (
    <>
      <FormField label={t("settings:branding.name")} hint={t("settings:branding.nameHint")}>
        {(p) => (
          <input
            {...p}
            className={inputClass}
            key={`name-${name}`}
            defaultValue={name}
            maxLength={60}
            placeholder={t("common:appName")}
            onBlur={(e) => {
              const next = e.target.value.trim();
              if (next !== name) save.mutate({ appName: next });
            }}
          />
        )}
      </FormField>
      <ImageField kind="logo" />
      <ImageField kind="favicon" />
    </>
  );
}
