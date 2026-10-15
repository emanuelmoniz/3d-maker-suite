import { useTranslation } from "react-i18next";
import { formatDuration } from "../../lib/format.ts";

/** A print's duration; an estimated one reads "~1h 20m" with a tooltip saying so. */
export function Duration({
  print,
}: {
  print: { durationSec: number; durationEstimated: boolean };
}) {
  const { t } = useTranslation();
  const text = formatDuration(print.durationSec);
  return print.durationEstimated ? (
    <span title={t("prints:estimatedTip")}>{t("prints:estimated", { value: text })}</span>
  ) : (
    text
  );
}
