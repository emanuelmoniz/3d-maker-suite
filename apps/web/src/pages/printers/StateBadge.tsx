import { useTranslation } from "react-i18next";

const LABELS = {
  working: "printers:state.working",
  maintenance: "printers:state.maintenance",
  inop: "printers:state.inop",
  retired: "printers:state.retired",
} as const;

/** Translated name for the built-in states; custom states show as typed. */
export function useStateLabel() {
  const { t } = useTranslation();
  return (state: string) => (state in LABELS ? t(LABELS[state as keyof typeof LABELS]) : state);
}

const TONE: Record<string, string> = {
  working: "bg-ok/15 text-ok",
  maintenance: "bg-warn/15 text-warn",
  inop: "bg-bad/15 text-bad",
};

export function StateBadge({ state }: { state: string }) {
  const label = useStateLabel();
  return (
    <span
      className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${TONE[state] ?? "bg-surface-2 text-muted"}`}
    >
      {label(state)}
    </span>
  );
}
