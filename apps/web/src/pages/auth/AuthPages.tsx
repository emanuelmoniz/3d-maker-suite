import { WIKI_ROUTES, type WikiTarget } from "@3d-maker-suite/core";
import { Link, useSearch } from "@tanstack/react-router";
import { type FormEvent, type ReactNode, useState } from "react";
import { useTranslation } from "react-i18next";
import { Button } from "../../components/Button.tsx";
import { FormField, inputClass } from "../../components/FormField.tsx";
import { HelpLink } from "../../components/HelpLink.tsx";
import { ApiError } from "../../lib/api.ts";
import { safeNext, useLogin, useSetup } from "../../lib/auth.ts";
import { brandMark, usePublicBranding } from "../../lib/branding.ts";
import { textLink } from "../../lib/cx.ts";

// Keys written out in full so `pnpm i18n:check` can see them.
const LOGIN_ERRORS: Record<string, string> = {
  invalid_credentials: "users:login.errors.invalid_credentials",
  too_many_attempts: "users:login.errors.too_many_attempts",
  user_disabled: "users:login.errors.user_disabled",
};
const SETUP_ERRORS: Record<string, string> = {
  setup_token: "users:setup.errors.setup_token",
  setup_done: "users:setup.errors.setup_done",
};

/**
 * The sidebar's mark (same `brandMark` rule), read from the public branding since there is no
 * session yet. Until it answers, or if it fails, icon + default name: no flash of the wrong logo.
 */
function AuthBrand() {
  const { t } = useTranslation();
  const data = usePublicBranding().data;
  const name = data?.appName || t("common:appName");
  const logo = data?.logo == null ? undefined : `/api/branding/logo?v=${data.logo}`;
  const mark = brandMark({ logo, showName: data?.showName ?? true });
  const img = "max-h-37.5 max-w-full object-contain";
  const fill = "h-auto max-h-16 w-full object-contain";
  return (
    <div className="mb-5 flex flex-wrap items-center justify-center gap-2.5 text-center font-semibold">
      {mark === "wordmark" ? (
        <img src="/logo.svg" alt={name} className={fill} />
      ) : mark === "logo" ? (
        <img src={logo} alt={name} className={fill} />
      ) : (
        <>
          <img src={logo ?? "/icon.svg"} alt="" className={logo ? img : "size-8 object-contain"} />
          <span className="min-w-0 wrap-anywhere">{name}</span>
        </>
      )}
    </div>
  );
}

/** Centered card without the app shell: nothing behind a login may load. */
function AuthCard({
  title,
  hint,
  help,
  children,
}: {
  title: string;
  hint?: string;
  /** These screens have no page header, so the card carries the Help icon. */
  help: WikiTarget;
  children: ReactNode;
}) {
  return (
    <main className="grid min-h-dvh place-items-center px-4 py-8">
      <div className="relative w-full max-w-sm rounded-lg border border-border bg-surface p-5 sm:p-6">
        <div className="absolute end-2 top-2">
          <HelpLink {...help} />
        </div>
        <AuthBrand />
        <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
        {hint && <p className="mt-1 text-muted">{hint}</p>}
        <div className="mt-5">{children}</div>
      </div>
    </main>
  );
}

const field = (f: FormData, k: string) => String(f.get(k) ?? "");

export function LoginPage() {
  const { t } = useTranslation();
  const next = safeNext(useSearch({ strict: false }).next);
  const login = useLogin(next);
  const code = login.error instanceof ApiError ? login.error.code : undefined;
  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    login.mutate({ email: field(f, "email"), password: field(f, "password") });
  };
  return (
    <AuthCard title={t("users:login.title")} help={WIKI_ROUTES["/login"]}>
      <form onSubmit={submit} className="grid gap-4">
        <FormField label={t("users:fields.email")}>
          {(p) => (
            <input
              {...p}
              name="email"
              type="email"
              autoComplete="username"
              required
              className={inputClass}
            />
          )}
        </FormField>
        <FormField label={t("users:fields.password")}>
          {(p) => (
            <input
              {...p}
              name="password"
              type="password"
              autoComplete="current-password"
              required
              className={inputClass}
            />
          )}
        </FormField>
        {login.isError && (
          <p role="alert" className="text-bad">
            {t(LOGIN_ERRORS[code ?? ""] ?? "users:login.errors.generic")}
          </p>
        )}
        <Button type="submit" variant="primary" disabled={login.isPending || login.isSuccess}>
          {t("users:login.submit")}
        </Button>
      </form>
    </AuthCard>
  );
}

/** First run: creates the admin. Open to anyone only while no account exists (the server checks). */
export function SetupPage() {
  const { t } = useTranslation();
  const setup = useSetup();
  const [mismatch, setMismatch] = useState(false);
  const code = setup.error instanceof ApiError ? setup.error.code : undefined;
  const submit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const f = new FormData(e.currentTarget);
    const bad = field(f, "password") !== field(f, "confirm");
    setMismatch(bad);
    if (bad) return;
    setup.mutate({
      displayName: field(f, "displayName"),
      email: field(f, "email"),
      password: field(f, "password"),
      token: field(f, "token") || undefined,
    });
  };
  return (
    <AuthCard
      title={t("users:setup.title")}
      hint={t("users:setup.hint")}
      help={WIKI_ROUTES["/setup"]}
    >
      <form onSubmit={submit} className="grid gap-4">
        <FormField label={t("users:fields.displayName")}>
          {(p) => (
            <input
              {...p}
              name="displayName"
              autoComplete="name"
              required
              maxLength={100}
              className={inputClass}
            />
          )}
        </FormField>
        <FormField label={t("users:fields.email")}>
          {(p) => (
            <input
              {...p}
              name="email"
              type="email"
              autoComplete="username"
              required
              className={inputClass}
            />
          )}
        </FormField>
        <FormField label={t("users:fields.newPassword")} hint={t("users:fields.passwordHint")}>
          {(p) => (
            <input
              {...p}
              name="password"
              type="password"
              autoComplete="new-password"
              required
              minLength={8}
              maxLength={256}
              className={inputClass}
            />
          )}
        </FormField>
        <FormField
          label={t("users:fields.confirmPassword")}
          error={mismatch ? t("users:fields.mismatch") : undefined}
        >
          {(p) => (
            <input
              {...p}
              name="confirm"
              type="password"
              autoComplete="new-password"
              required
              className={inputClass}
            />
          )}
        </FormField>
        {code === "setup_token" && (
          <FormField label={t("users:setup.token")} hint={t("users:setup.tokenHint")}>
            {(p) => <input {...p} name="token" required className={inputClass} />}
          </FormField>
        )}
        {setup.isError && (
          <p role="alert" className="text-bad">
            {t(SETUP_ERRORS[code ?? ""] ?? "users:setup.errors.generic")}
          </p>
        )}
        {code === "setup_done" && (
          <Link to="/login" className={textLink}>
            {t("users:setup.toLogin")}
          </Link>
        )}
        <Button type="submit" variant="primary" disabled={setup.isPending || setup.isSuccess}>
          {t("users:setup.submit")}
        </Button>
      </form>
    </AuthCard>
  );
}
