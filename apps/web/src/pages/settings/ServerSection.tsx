import type { ServerConfigPatch, ServerConfigResponse } from "@3d-maker-suite/core";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useTranslation } from "react-i18next";
import { Button } from "../../components/Button.tsx";
import { FormField, inputClass } from "../../components/FormField.tsx";
import { api } from "../../lib/api.ts";

const KEY = ["server-config"];
// i18n keys are written out in full so `pnpm i18n:check` can see them.
const SOURCES = {
  cli: "settings:server.sources.cli",
  env: "settings:server.sources.env",
  file: "settings:server.sources.file",
  default: "settings:server.sources.default",
} as const;
const LOOPBACK = ["localhost", "127.0.0.1", "::1", "[::1]"];

export function ServerSection() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const { data } = useQuery({
    queryKey: KEY,
    queryFn: () => api<ServerConfigResponse>("GET", "/api/server-config"),
  });
  const save = useMutation({
    mutationFn: (patch: ServerConfigPatch) =>
      api<ServerConfigResponse>("PATCH", "/api/server-config", patch),
    onSuccess: (res) => qc.setQueryData(KEY, res),
  });
  const restart = useMutation({
    mutationFn: () => api("POST", "/api/server-config/restart"),
  });
  if (!data) return null;
  const { effective, saved } = data;
  const pending =
    (saved.host ?? effective.host) !== effective.host ||
    (saved.port ?? effective.port) !== effective.port;
  // A flag or env var keeps winning after the restart; otherwise the saved value does.
  const nextHost = ["cli", "env"].includes(effective.hostSource)
    ? effective.host
    : (saved.host ?? effective.host);
  const nextPort = ["cli", "env"].includes(effective.portSource)
    ? effective.port
    : (saved.port ?? effective.port);

  const restartAndOpen = () => {
    const tab = window.open("about:blank", "_blank"); // opened now, on the click, so it isn't blocked
    const bound = ["0.0.0.0", "::", "[::]"].includes(nextHost);
    // Behind the Vite dev server (a different port than the API), come back to that same address.
    const url =
      location.port !== String(effective.port)
        ? `${location.origin}/`
        : `${location.protocol}//${bound ? location.hostname : nextHost}:${nextPort}/`;
    restart.mutate(undefined, {
      onSuccess: async () => {
        for (let i = 0; i < 40; i++) {
          await new Promise((r) => setTimeout(r, 500));
          const up = await fetch(`${url}api/health`, { mode: "no-cors" }).then(
            () => true,
            () => false,
          );
          if (!up) continue;
          if (tab) tab.location.href = url;
          else window.open(url, "_blank");
          return;
        }
        tab?.close();
      },
      onError: () => tab?.close(),
    });
  };

  return (
    <div className="grid gap-4">
      <FormField
        label={t("settings:server.host")}
        hint={t("settings:server.current", {
          value: effective.host,
          source: t(SOURCES[effective.hostSource]),
        })}
      >
        {(p) => (
          <input
            {...p}
            className={inputClass}
            key={`host-${saved.host}`}
            defaultValue={saved.host ?? ""}
            placeholder={effective.host}
            onBlur={(e) => {
              const host = e.target.value.trim() || null;
              if (host !== (saved.host ?? null)) save.mutate({ host });
            }}
          />
        )}
      </FormField>
      <FormField
        label={t("settings:server.port")}
        hint={t("settings:server.current", {
          value: effective.port,
          source: t(SOURCES[effective.portSource]),
        })}
      >
        {(p) => (
          <input
            {...p}
            className={inputClass}
            type="number"
            min={1}
            max={65535}
            step={1}
            key={`port-${saved.port}`}
            defaultValue={saved.port ?? ""}
            placeholder={String(effective.port)}
            onBlur={(e) => {
              const port = e.target.value === "" ? null : e.target.valueAsNumber;
              if (e.target.checkValidity() && port !== (saved.port ?? null)) save.mutate({ port });
              else if (!e.target.checkValidity()) e.target.value = String(saved.port ?? "");
            }}
          />
        )}
      </FormField>
      {!LOOPBACK.includes(nextHost) && !data.passwordSet && (
        <p role="alert" className="text-bad">
          {t("settings:server.passwordNeeded")}
        </p>
      )}
      {pending && (
        <p role="status" className="font-medium text-ok">
          {t("settings:server.restart")}
        </p>
      )}
      <div>
        <Button disabled={restart.isPending || restart.isSuccess} onClick={restartAndOpen}>
          {t("settings:server.restartButton")}
        </Button>
        <p className="mt-1 text-muted">{t("settings:server.restartHint")}</p>
      </div>
      {save.isError && (
        <p role="alert" className="text-bad">
          {t("settings:saveError")}
        </p>
      )}
    </div>
  );
}
