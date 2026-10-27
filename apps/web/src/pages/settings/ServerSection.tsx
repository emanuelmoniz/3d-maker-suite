import type { AutostartState, ServerConfigPatch, ServerConfigResponse } from "@3d-maker-suite/core";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "../../components/Button.tsx";
import { ConfirmDialog } from "../../components/ConfirmDialog.tsx";
import { FormField, inputClass } from "../../components/FormField.tsx";
import { Switch } from "../../components/Switch.tsx";
import { api } from "../../lib/api.ts";
import { useCan, useMe } from "../../lib/auth.ts";
import { usePreferences, useSavePreferences } from "../../lib/preferences.ts";
import { useSetServerState } from "../../lib/serverState.ts";

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
    enabled: useCan("admin"),
  });

/** Host and port the server uses after a restart: a flag or env var still wins, then saved, then default. */
function nextAddress({ effective, saved, defaults }: ServerConfigResponse) {
  const fixed = (src: string) => src === "cli" || src === "env";
  return {
    host: fixed(effective.hostSource) ? effective.host : (saved.host ?? defaults.host),
    port: fixed(effective.portSource) ? effective.port : (saved.port ?? defaults.port),
  };
}

/** Restart and Stop, rendered in the page header. */
export function ServerActions() {
  const { t } = useTranslation();
  const { data } = useServerConfig();
  // Read the config again at click time: a port field just left may not have reached `data` yet.
  const restart = useMutation({
    mutationFn: async () => {
      const fresh = await api<ServerConfigResponse>("GET", "/api/server-config");
      const { host, port } = nextAddress(fresh);
      const bound = ["0.0.0.0", "::", "[::]"].includes(host);
      // Behind the Vite dev server (a different port than the API), come back to that same address.
      const url =
        location.port !== String(fresh.effective.port)
          ? `${location.origin}/`
          : `${location.protocol}//${bound ? location.hostname : host}:${port}/`;
      await api("POST", "/api/server-config/restart");
      return url;
    },
  });
  const stop = useMutation({ mutationFn: () => api("POST", "/api/server-config/stop") });
  const [confirmStop, setConfirmStop] = useState(false);
  const setState = useSetServerState();
  if (!data) return null;
  const restartInPlace = () => {
    restart.mutate(undefined, {
      onSuccess: async (url) => {
        setState({ kind: "restarting", url, timedOut: false });
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
        setState({ kind: "restarting", url, timedOut: true });
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
          stop.mutate(undefined, { onSuccess: () => setState({ kind: "stopped" }) });
        }}
        onCancel={() => setConfirmStop(false)}
      />
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
    enabled: useCan("admin"),
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

/** The hub switch (ADR-0014): off by default, and only with user accounts (devices act as one). */
export function HubSwitch() {
  const { t } = useTranslation();
  const on = usePreferences().data?.values.hubEnabled;
  const save = useSavePreferences();
  // An admin without a session is the no-accounts mode (ADR-0012).
  const noUsers = !useMe();
  if (on === undefined) return null;
  return (
    <div>
      <Switch
        label={t("settings:hub.enabled")}
        aria-describedby="hub-enabled-hint"
        checked={on}
        disabled={save.isPending || (noUsers && !on)}
        onChange={(e) => save.mutate({ hubEnabled: e.target.checked })}
      />
      <p id="hub-enabled-hint" className="text-muted">
        {t("settings:hub.enabledHint")}
      </p>
      {noUsers && <p className="text-muted">{t("settings:hub.needsUsers")}</p>}
      {save.isError && (
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
  const next = nextAddress(data);
  const pending = next.host !== effective.host || next.port !== effective.port;
  const nextHost = next.host;

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
