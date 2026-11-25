// The hub addresses a connector knows (6.3.0 Step 7b): the one that answered last (`hubUrl`), and
// newer ones the hub announced (`hub.address`, `X-Hub-Address`) that haven't answered yet. It tries
// the newest first and drops an older one only once a newer one has answered.

/** How many announced addresses it keeps waiting at most. */
const KEEP = 4;

type Addresses = { hubUrl?: string; nextHubUrls?: string[]; deviceId?: string; link?: string };

/** An http(s) address as the connector keeps it: origin and path, no trailing slash; else undefined. */
export function normalizeHubUrl(raw: string): string | undefined {
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    return undefined;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return undefined;
  // A hub behind a path prefix (https://x.example/maker) keeps it.
  return `${url.origin}${url.pathname.replace(/\/+$/, "")}`;
}

/** The order to try them in: the newest announced first, the one that answered last at the end. */
export const tryOrder = (s: Addresses): string[] => [
  ...(s.nextHubUrls ?? []),
  ...(s.hubUrl ? [s.hubUrl] : []),
];

/**
 * The state patch for an address the hub announced, or undefined when there is nothing new: it is
 * the one in use, the newest already, or one that refused this device during this run.
 */
export function announced(s: Addresses, raw: string, refused: ReadonlySet<string> = new Set()) {
  const url = normalizeHubUrl(raw);
  if (!url || url === s.hubUrl || refused.has(url) || s.nextHubUrls?.[0] === url) return undefined;
  return {
    nextHubUrls: [url, ...(s.nextHubUrls ?? []).filter((u) => u !== url)].slice(0, KEEP),
  };
}

/** The pairing `sync.json` and `presets.json` belong to: the address it paired at and its device id. */
export const linkOf = (s: Addresses) => s.link ?? `${s.hubUrl}|${s.deviceId}`;

/**
 * The state patch once `url` has answered: it is the address in use, and every older one goes.
 * Newer ones that haven't answered stay first in line. The pairing identity stays the same.
 */
export function answered(s: Addresses, url: string) {
  if (url === s.hubUrl) return undefined;
  const next = s.nextHubUrls ?? [];
  const at = next.indexOf(url);
  return {
    hubUrl: url,
    nextHubUrls: at < 0 ? next.filter((u) => u !== url) : next.slice(0, at),
    link: linkOf(s),
  };
}

/** The origins the paired hub may be opened at: the one in use and the ones it announced. */
export const hubOrigins = (s: Addresses): string[] =>
  tryOrder(s).flatMap((u) => {
    try {
      return [new URL(u).origin];
    } catch {
      return [];
    }
  });
