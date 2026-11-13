import type {
  ServerConfigPatch,
  ServerConfigResponse,
  TestAddressResult,
} from "@3d-maker-suite/core";
import { useMutation } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "../../components/Button.tsx";
import { inputClass } from "../../components/FormField.tsx";
import { api } from "../../lib/api.ts";
import { linkButton } from "../filament/SpoolDetailPage.tsx";
import { tileClass } from "./IntegrationFormPage.tsx";

const RESULTS = {
  ok: "settings:server.public.result.ok",
  notFound: "settings:server.public.result.notFound",
  refused: "settings:server.public.result.refused",
  certificate: "settings:server.public.result.certificate",
  timeout: "settings:server.public.result.timeout",
  otherServer: "settings:server.public.result.otherServer",
  hostNotAllowed: "settings:server.public.result.hostNotAllowed",
} as const satisfies Record<TestAddressResult, string>;

type Mode = "auto" | "internal" | "external";
const HTTP_URL = /^https?:\/\/[^/\s]/i;
const PRIVATE_IP = /^http:\/\/(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)\d+\.\d+(\.\d+)?(:\d+)?$/;

/** The mode comes from the saved value; only the URL is stored. */
const modeOf = (url?: string): Mode =>
  !url ? "auto" : PRIVATE_IP.test(url) ? "internal" : "external";

/**
 * Where links in notifications point. The chosen option opens its own control in place, and the
 * line under the group always says what an alert will link to right now.
 */
export function PublicAddress({
  data,
  port,
  save,
}: {
  data: ServerConfigResponse;
  /** The port the app has after a restart: the Internal IP options use it. */
  port: number;
  save: { mutate: (patch: ServerConfigPatch) => void; isPending: boolean };
}) {
  const { t } = useTranslation();
  const { effective, saved, detected, docker, link } = data;
  const fixed = effective.publicUrlSource === "env";
  const savedUrl = effective.publicUrl;
  const [picked, setPicked] = useState<Mode | null>(null);
  const [invalid, setInvalid] = useState(false);
  // Tied to the address it tested, so changing the address hides a stale result.
  const [result, setResult] = useState<{ url: string; code: TestAddressResult } | null>(null);
  const test = useMutation({
    mutationFn: (url: string) =>
      api<{ result: TestAddressResult }>("POST", "/api/server-config/test-address", { url }),
    onSuccess: (res, url) => setResult({ url, code: res.result }),
  });
  const mode = picked ?? modeOf(savedUrl);
  const ips = detected.map((ip) => `http://${ip}:${port}`);
  // A typed field in Docker (its detected list is empty); otherwise this machine's addresses.
  const typedInternal = docker || ips.length === 0;

  const commit = (value: string) => {
    const url = value.trim();
    const ok = !url || HTTP_URL.test(url);
    setInvalid(!ok);
    if (ok && url.replace(/\/+$/, "") !== (saved.publicUrl ?? ""))
      save.mutate({ publicUrl: url || null });
  };
  const pick = (next: Mode) => {
    setPicked(next);
    setInvalid(false);
    if (next === "auto") save.mutate({ publicUrl: null });
    else if (next === "internal" && !typedInternal && !ips.includes(savedUrl ?? ""))
      save.mutate({ publicUrl: ips[0] });
  };

  const options: { id: Mode; label: string; hint: string }[] = [
    {
      id: "auto",
      label: t("settings:server.public.auto"),
      hint: t("settings:server.public.autoHint"),
    },
    {
      id: "internal",
      label: t("settings:server.public.internal"),
      hint: t("settings:server.public.internalHint"),
    },
    {
      id: "external",
      label: t("settings:server.public.external"),
      hint: t("settings:server.public.externalHint"),
    },
  ];
  const typed = (id: string, placeholder: string) => (
    <div className="mt-2 flex flex-wrap items-start gap-2">
      <input
        id={id}
        aria-label={t("settings:server.public.typed")}
        aria-invalid={invalid || undefined}
        aria-describedby={invalid ? `${id}-error` : undefined}
        className={`${inputClass} min-w-0 flex-1 basis-56`}
        // Remounts when the saved value changes, so a save shows as stored (no trailing slash).
        key={`${id}-${saved.publicUrl}`}
        defaultValue={mode === modeOf(savedUrl) ? (savedUrl ?? "") : ""}
        placeholder={placeholder}
        inputMode="url"
        onBlur={(e) => commit(e.target.value)}
      />
      <Button
        type="button"
        onClick={() => {
          (document.getElementById(id) as HTMLInputElement).value = location.origin;
          commit(location.origin);
        }}
      >
        {t("settings:server.public.useThis")}
      </Button>
      {invalid && (
        <p id={`${id}-error`} role="alert" className="basis-full text-bad">
          {t("settings:server.public.invalid")}
        </p>
      )}
    </div>
  );

  return (
    <div className="grid gap-2">
      <fieldset className="grid gap-2" disabled={fixed}>
        <legend className="mb-1.5 font-medium">{t("settings:server.public.title")}</legend>
        {options.map((o) => (
          <label key={o.id} className={tileClass}>
            <input
              type="radio"
              name="public-address"
              className="mt-1"
              checked={mode === o.id}
              onChange={() => pick(o.id)}
            />
            <span className="min-w-0 flex-1">
              <span className="block font-medium">{o.label}</span>
              <span className="block text-muted">{o.hint}</span>
              {mode === o.id && o.id === "internal" && !typedInternal && (
                <select
                  aria-label={t("settings:server.public.internal")}
                  className={`${inputClass} mt-2`}
                  value={savedUrl}
                  disabled={save.isPending}
                  onChange={(e) => save.mutate({ publicUrl: e.target.value })}
                >
                  {ips.map((u) => (
                    <option key={u} value={u}>
                      {u}
                    </option>
                  ))}
                </select>
              )}
              {mode === o.id &&
                o.id === "internal" &&
                typedInternal &&
                typed("public-internal", `http://192.168.1.20:${port}`)}
              {mode === o.id &&
                o.id === "external" &&
                typed("public-external", "https://maker.example.com")}
            </span>
          </label>
        ))}
        <p role="status" className="text-muted">
          {fixed
            ? t("settings:server.public.fixed", { value: effective.publicUrl })
            : link
              ? t("settings:server.public.link", { value: link })
              : t("settings:server.public.noLink")}
        </p>
      </fieldset>
      {link && (
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" busy={test.isPending} onClick={() => test.mutate(link)}>
            {t("settings:server.public.test")}
          </Button>
          <a href={link} target="_blank" rel="noreferrer" className={linkButton}>
            {t("settings:server.public.open")}
          </a>
        </div>
      )}
      {result && result.url === link && (
        <p role="status" className={result.code === "ok" ? "text-ok" : "text-bad"}>
          {t(RESULTS[result.code])}
          {result.code !== "ok" && ` ${t("settings:server.public.mayBeFalse")}`}
        </p>
      )}
    </div>
  );
}
