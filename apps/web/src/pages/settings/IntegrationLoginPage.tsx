import type { LoginChallenge, LoginRequest } from "@3d-maker-suite/core";
import { useNavigate, useParams } from "@tanstack/react-router";
import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "../../components/Button.tsx";
import { FormField, inputClass } from "../../components/FormField.tsx";
import { PageHeader } from "../../components/PageHeader.tsx";
import { useIntegrations, useLogin } from "../../lib/integrations.ts";
import { ERRORS } from "./IntegrationsPage.tsx";

// Literal keys so `pnpm i18n:check` sees them.
const CHALLENGES: Record<LoginChallenge, string> = {
  email_code: "integrations:login.email_code",
  totp: "integrations:login.totp",
};

/** Email + password, then the code the vendor asks for. The server keeps the pending step. */
export function IntegrationLoginPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { id } = useParams({ strict: false }) as { id: string };
  const integration = useIntegrations().data?.find((i) => i.id === id);
  const login = useLogin(id);
  const [challenge, setChallenge] = useState<LoginChallenge>();
  const failed = login.data?.status === "error" ? login.data.code : undefined;

  const onSubmit = (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const body: LoginRequest = challenge
      ? { code: String(f.get("code") ?? "").trim() }
      : { email: String(f.get("email") ?? "").trim(), password: String(f.get("password") ?? "") };
    login.mutate(body, {
      onSuccess: (r) => {
        if (r.status === "challenge") setChallenge(r.challenge);
        if (r.status === "ok") navigate({ to: "/settings/integrations" });
      },
      // e.g. the pending step expired: start over.
      onError: () => setChallenge(undefined),
    });
  };

  return (
    <>
      <PageHeader
        title={t("integrations:login.title", { name: integration?.name ?? "" })}
        description={challenge ? t(CHALLENGES[challenge]) : undefined}
      />
      <form key={challenge ?? "password"} onSubmit={onSubmit} className="grid gap-4 sm:max-w-md">
        {challenge ? (
          <FormField label={t("integrations:login.code")}>
            {(p) => (
              <input
                {...p}
                name="code"
                required
                autoComplete="one-time-code"
                inputMode="numeric"
                className={inputClass}
              />
            )}
          </FormField>
        ) : (
          <>
            <FormField label={t("integrations:login.email")}>
              {(p) => (
                <input
                  {...p}
                  name="email"
                  type="email"
                  required
                  autoComplete="username"
                  className={inputClass}
                />
              )}
            </FormField>
            <FormField
              label={t("integrations:login.password")}
              hint={t("integrations:login.passwordHint")}
            >
              {(p) => (
                <input
                  {...p}
                  name="password"
                  type="password"
                  required
                  autoComplete="current-password"
                  className={inputClass}
                />
              )}
            </FormField>
          </>
        )}
        {failed && (
          <p role="alert" className="text-bad">
            {t(ERRORS[failed])}
          </p>
        )}
        {login.isError && (
          <p role="alert" className="text-bad">
            {t("integrations:login.error")}
          </p>
        )}
        <div className="flex gap-2">
          <Button type="submit" variant="primary" disabled={login.isPending}>
            {challenge ? t("integrations:login.verify") : t("integrations:login.submit")}
          </Button>
          <Button onClick={() => navigate({ to: "/settings/integrations" })}>
            {t("common:actions.cancel")}
          </Button>
        </div>
      </form>
    </>
  );
}
