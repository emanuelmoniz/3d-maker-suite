export const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(" ");
/** A text link: one design across the app (Integrations' account card set it). */
export const textLink = "font-medium text-accent hover:underline";
/** A link in muted text keeps the muted colour. */
export const mutedLink = "text-muted hover:underline";
