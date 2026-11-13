import type { TestAddressResult } from "@3d-maker-suite/core";

const CERT = /CERT|SELF_SIGNED|UNABLE_TO_VERIFY|ALTNAME/;
const DNS = ["ENOTFOUND", "EAI_AGAIN", "EAI_NODATA"];

/** A failed fetch to a result code. Anything that never connected counts as refused. */
export function classifyError(err: unknown): TestAddressResult {
  if (err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError"))
    return "timeout";
  const code = String((err as { cause?: { code?: string } })?.cause?.code ?? "");
  if (DNS.includes(code)) return "notFound";
  if (CERT.test(code)) return "certificate";
  if (code.startsWith("UND_ERR_") && code.includes("TIMEOUT")) return "timeout";
  if (code === "ETIMEDOUT") return "timeout";
  return "refused";
}

/**
 * Calls `<url>/api/health` from this server and checks `startedAt` is ours, which proves the address
 * reaches this very process. Redirects aren't followed, and only a code comes back, never the body.
 */
export async function testAddress(
  url: string,
  startedAt: string,
  timeoutMs = 5000,
): Promise<TestAddressResult> {
  let res: Response;
  try {
    res = await fetch(`${url}/api/health`, {
      redirect: "manual",
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch (err) {
    return classifyError(err);
  }
  try {
    if (res.status === 403) {
      const body = (await res.json()) as { error?: { code?: string } };
      return body.error?.code === "forbidden_host" ? "hostNotAllowed" : "otherServer";
    }
    if (res.status !== 200) return "otherServer";
    const body = (await res.json()) as { startedAt?: string };
    return body.startedAt === startedAt ? "ok" : "otherServer";
  } catch (err) {
    // A body that stalls hits the same timeout; one that isn't JSON is some other server.
    return err instanceof Error && err.name === "TimeoutError" ? "timeout" : "otherServer";
  }
}
