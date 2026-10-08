import { type IntegrationAdapter, IntegrationError } from "@3d-maker-suite/core";
import { z } from "zod";
import { call, cookie, parse, REGIONS, type Region, URLS } from "./cloud.ts";

const configSchema = z.object({ region: z.enum(REGIONS).default("global") });
// Optional so the integration can exist before the user signs in. The password is never stored,
// and there is no refresh: the upstream refresh endpoint only answers 401, so an expired token
// (about every 3 months) shows up as `auth_expired` and the user signs in again.
const secretsSchema = z.object({ token: z.string().min(1).optional() });

const loginResponse = z.object({
  accessToken: z.string().optional(),
  loginType: z.string().optional(),
  tfaKey: z.string().optional(),
});
// Unknown keys are dropped, so the LAN access code (`dev_access_code`) never leaves this file.
const bindResponse = z.object({
  devices: z.array(
    z.object({
      dev_id: z.string().min(1),
      name: z.string().nullish(),
      dev_product_name: z.string(),
      nozzle_diameter: z.union([z.string(), z.number()]).nullish(),
    }),
  ),
});
type LoginState = { email?: string; tfaKey?: string };

export function bambuCloudAdapter(): IntegrationAdapter {
  return {
    id: "bambu-cloud",
    configSchema,
    secretsSchema,

    async login({ config, log, signal }, input) {
      const { region } = config as { region: Region };
      const base = { region, log, signal };
      // Wrong credentials or codes come back as 400/401/403 JSON.
      const attempt = (url: string, body: unknown, headers?: Record<string, string>) =>
        call(url, { ...base, body, headers, expect: [400, 401, 403] });

      if ("password" in input) {
        const res = await attempt(URLS.login, {
          account: input.email,
          password: input.password,
          apiError: "",
        });
        if (!res.ok) throw new IntegrationError("login_failed");
        const r = await parse(res, loginResponse, log);
        if (r.accessToken) return { secrets: { token: r.accessToken } };
        if (r.loginType === "verifyCode") {
          await call(URLS.emailCode, { ...base, body: { email: input.email, type: "codeLogin" } });
          return { challenge: "email_code", state: JSON.stringify({ email: input.email }) };
        }
        if (r.loginType === "tfa" && r.tfaKey)
          return { challenge: "totp", state: JSON.stringify({ tfaKey: r.tfaKey }) };
        throw new IntegrationError("api_changed");
      }

      const state = JSON.parse(input.state) as LoginState;
      if (state.tfaKey) {
        // The 2FA step lives on the website and wants its CSRF cookie echoed as a header.
        const csrf = cookie(await call(URLS.csrf, base), "bbl_csrf_token");
        if (!csrf) throw new IntegrationError("api_changed");
        const res = await attempt(
          URLS.tfaLogin,
          { tfaKey: state.tfaKey, tfaCode: input.code },
          { "x-bbl-csrf-token": csrf, cookie: `bbl_csrf_token=${csrf}` },
        );
        const token = res.ok ? cookie(res, "token") : undefined;
        if (!token) throw new IntegrationError("code_invalid");
        return { secrets: { token } };
      }
      const res = await attempt(URLS.login, { account: state.email, code: input.code });
      const token = res.ok ? (await parse(res, loginResponse, log)).accessToken : undefined;
      if (!token) throw new IntegrationError("code_invalid");
      return { secrets: { token } };
    },

    create: ({ config, secrets, log, signal }) => {
      const { region } = config as { region: Region };
      const devices = async () => {
        const token = await secrets.get("token");
        if (!token) throw new IntegrationError("auth_required");
        const res = await call(URLS.bind, { region, log, signal, token });
        return (await parse(res, bindResponse, log)).devices;
      };
      return {
        // Thrown errors become a failed TestResult in the server.
        test: async () => {
          await devices();
          return { ok: true };
        },
        printers: {
          listPrinters: async () =>
            (await devices()).map((d) => ({
              externalId: d.dev_id,
              serial: d.dev_id,
              name: d.name || d.dev_id,
              brand: "Bambu Lab",
              model: d.dev_product_name,
              nozzleDiameterMm: Number(d.nozzle_diameter) || undefined,
            })),
        },
      };
    },
  };
}
