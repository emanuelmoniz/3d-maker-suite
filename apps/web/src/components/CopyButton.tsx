import { useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { copyText } from "../lib/clipboard.ts";
import { Button } from "./Button.tsx";

const SHOWN_MS = 2000;

/**
 * Copies a one-time code. The result is announced in an aria-live region and shown briefly
 * next to the button; on failure it asks the user to select the code by hand.
 */
export function CopyButton({ value, label }: { value: string; label: string }) {
  const { t } = useTranslation();
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  const timer = useRef<number | undefined>(undefined);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  const copy = async () => {
    const ok = await copyText(value);
    setState(ok ? "copied" : "failed");
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setState("idle"), SHOWN_MS);
  };

  const message =
    state === "copied"
      ? t("common:copy.copied")
      : state === "failed"
        ? t("common:copy.failed")
        : "";

  return (
    <div className="flex flex-wrap items-center justify-center gap-2">
      <Button onClick={copy}>{label}</Button>
      <span role="status" aria-live="polite" className="text-sm text-muted">
        {message}
      </span>
    </div>
  );
}
