import type { AutostartState, ServerConfigPatch, ServerConfigResponse } from "@3d-maker-suite/core";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "../../components/Button.tsx";
import { ConfirmDialog } from "../../components/ConfirmDialog.tsx";
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

const useServerConfig = () =>
  useQuery({
    queryKey: KEY,
    queryFn: () => api<ServerConfigResponse>("GET", "/api/server-config"),
  });

/** Restart and Stop, rendered in the page header. */
export function ServerActions() {
  const { t } = useTranslation();
  const { data } = useServerConfig();
  const restart = useMutation({
    mutationFn: () => api("POST", "/api/server-config/restart"),
  });
  const stop = useMutation({ mutationFn: () => api("POST", "/api/server-config/stop") });
  const [confirmStop, setConfirmStop] = useState(false);
  const [restartUrl, setRestartUrl] = useState<string | null>(null);
  const [timedOut, setTimedOut] = useState(false);
  if (!data) return null;
  const { effective, saved } = data;
  // A flag or env var keeps winning after the restart; otherwise the saved value does.
  const nextHost = ["cli", "env"].includes(effective.hostSource)
    ? effective.host
    : (saved.host ?? effective.host);
  const nextPort = ["cli", "env"].includes(effective.portSource)
    ? effective.port
    : (saved.port ?? effective.port);

  const restartInPlace = () => {
    const bound = ["0.0.0.0", "::", "[::]"].includes(nextHost);
    // Behind the Vite dev server (a different port than the API), come back to that same address.
    const url =
      location.port !== String(effective.port)
        ? `${location.origin}/`
        : `${location.protocol}//${bound ? location.hostname : nextHost}:${nextPort}/`;
    restart.mutate(undefined, {
      onSuccess: async () => {
        setRestartUrl(url);
        for (let i = 0; i < 60; i++) {
          await new Promise((r) => setTimeout(r, 500));
          const up = await fetch(`${url}api/health`, { mode: "no-cors" }).then(
            () => true,
            () => false,
          );
          if (!up) continue;
          if (url === `${location.origin}/`) location.reload();
          else location.assign(url);
          return;
        }
        setTimedOut(true);
      },
    });
  };

  return (
    <>
      <Button disabled={restart.isPending || restart.isSuccess} onClick={restartInPlace}>
        {t("settings:server.restartButton")}
      </Button>
      <Button
        variant="danger"
        disabled={stop.isPending || stop.isSuccess}
        onClick={() => setConfirmStop(true)}
      >
        {t("settings:server.stopButton")}
      </Button>
      <ConfirmDialog
        open={confirmStop}
        destructive
        title={t("settings:server.stopTitle")}
        description={t("settings:server.stopBody")}
        confirmLabel={t("settings:server.stopButton")}
        onConfirm={() => {
          setConfirmStop(false);
          stop.mutate();
        }}
        onCancel={() => setConfirmStop(false)}
      />
      {restartUrl && (
        <dialog
          ref={(d) => {
            if (d && !d.open) d.showModal();
          }}
          onCancel={(e) => e.preventDefault()}
          aria-labelledby="restarting-title"
          className="m-auto w-[min(92vw,26rem)] rounded-lg border border-border bg-surface p-5 text-fg"
        >
          <h2 id="restarting-title" className="text-base font-semibold">
            {t("settings:server.restartingTitle")}
          </h2>
          {timedOut ? (
            <p role="alert" className="mt-2 text-bad">
              {t("settings:server.restartTimeout")}{" "}
              <a href={restartUrl} className="underline">
                {restartUrl}
              </a>
            </p>
          ) : (
            <p role="status" className="mt-2 text-muted">
              {t("settings:server.restartingBody")}
            </p>
          )}
        </dialog>
      )}
      {stop.isSuccess && (
        <p role="status" className="w-full text-muted">
          {t("settings:server.stopped")}
        </p>
      )}
    </>
  );
}

/** Start at login, rendered in the General section. */
export function StartAtLogin() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  // Not supported = no launch command known (Docker, dev): the toggle stays hidden.
  const login = useQuery({
    queryKey: [...KEY, "autostart"],
    queryFn: () => api<AutostartState>("GET", "/api/server-config/autostart"),
  });
  const setLogin = useMutation({
    mutationFn: (enabled: boolean) =>
      api<AutostartState>("PUT", "/api/server-config/autostart", { enabled }),
    onSuccess: (res) => qc.setQueryData([...KEY, "autostart"], res),
  });
  if (!login.data?.supported) return null;
  return (
    <div>
      <label className="flex items-center gap-2">
        <input
          type="checkbox"
          checked={login.data.enabled}
          disabled={setLogin.isPending}
          onChange={(e) => setLogin.mutate(e.target.checked)}
        />
        {t("settings:server.startAtLogin")}
      </label>
      <p className="mt-1 text-muted">{t("settings:server.startAtLoginHint")}</p>
      {setLogin.isError && (
        <p role="alert" className="text-bad">
          {t("settings:saveError")}
        </p>
      )}
    </div>
  );
}

/** Host and port. */
export function ServerSection() {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const { data } = useServerConfig();
  const save = useMutation({
    mutationFn: (patch: ServerConfigPatch) =>
      api<ServerConfigResponse>("PATCH", "/api/server-config", patch),
    onSuccess: (res) => qc.setQueryData(KEY, res),
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
      <p className="text-muted">{t("settings:server.networkHint")}</p>
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
      {save.isError && (
        <p role="alert" className="text-bad">
          {t("settings:saveError")}
        </p>
      )}
    </div>
  );
}
