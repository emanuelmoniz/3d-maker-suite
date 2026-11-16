import { REVIEW_POLICIES, type ReviewPolicy } from "@3d-maker-suite/core";
import { useTranslation } from "react-i18next";
import { Combobox } from "./Combobox.tsx";
import { FormField } from "./FormField.tsx";

/** The level names, spelled out so the i18n check sees them. */
export const REVIEW_LEVEL_LABELS: Record<ReviewPolicy, string> = {
  never: "common:reviewLevel.levels.never",
  unmatched: "common:reviewLevel.levels.unmatched",
  always: "common:reviewLevel.levels.always",
};

/**
 * A review level (ADR-0015) for prints recorded automatically: never, when unsure, always, or
 * "use the default" (null) that follows the level above. Shows the level in effect and whose it is.
 * `above`: what null follows, as `{ level, from }`; `from` is the i18n key of the level's owner.
 * `name` makes it an uncontrolled form field (value "" = default); otherwise `onChange`.
 */
export function ReviewLevelField({
  value,
  onChange,
  name,
  above,
  disabled,
  label,
}: {
  value: ReviewPolicy | null;
  onChange?: (v: ReviewPolicy | null) => void;
  name?: string;
  above: { level: ReviewPolicy; from: string };
  disabled?: boolean;
  label?: string;
}) {
  const { t } = useTranslation();
  const options = [
    { value: "", label: t("common:reviewLevel.default") },
    ...REVIEW_POLICIES.map((p) => ({ value: p, label: t(REVIEW_LEVEL_LABELS[p]) })),
  ];
  const own = value != null;
  const effective = value ?? above.level;
  return (
    <FormField
      label={label ?? t("common:reviewLevel.label")}
      hint={t("common:reviewLevel.hint", {
        level: t(REVIEW_LEVEL_LABELS[effective]),
        from: t(own ? "common:reviewLevel.fromHere" : above.from),
      })}
    >
      {(p) =>
        name ? (
          <Combobox
            {...p}
            name={name}
            defaultValue={value ?? ""}
            disabled={disabled}
            options={options}
          />
        ) : (
          <Combobox
            {...p}
            value={value ?? ""}
            disabled={disabled}
            onChange={(v) => onChange?.((v || null) as ReviewPolicy | null)}
            options={options}
          />
        )
      }
    </FormField>
  );
}
