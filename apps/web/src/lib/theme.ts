import { useSyncExternalStore } from "react";

export const MODES = ["light", "dark", "system"] as const;
export const ACCENTS = ["teal", "blue", "violet", "rose", "amber"] as const;
export type Mode = (typeof MODES)[number];
export type Accent = (typeof ACCENTS)[number];
type Theme = { mode: Mode; accent: Accent };

const KEY = "theme";
const dark = matchMedia("(prefers-color-scheme: dark)");

function load(): Theme {
  try {
    const s = JSON.parse(localStorage.getItem(KEY) ?? "{}");
    return {
      mode: MODES.includes(s.mode) ? s.mode : "system",
      accent: ACCENTS.includes(s.accent) ? s.accent : "teal",
    };
  } catch {
    return { mode: "system", accent: "teal" };
  }
}

let theme = load();
const listeners = new Set<() => void>();

function apply() {
  const el = document.documentElement;
  el.dataset.theme = theme.mode === "system" ? (dark.matches ? "dark" : "light") : theme.mode;
  el.dataset.accent = theme.accent;
}

export function setTheme(patch: Partial<Theme>) {
  theme = { ...theme, ...patch };
  try {
    localStorage.setItem(KEY, JSON.stringify(theme));
  } catch {}
  apply();
  for (const l of listeners) l();
}

dark.addEventListener("change", apply);
apply();

export function useTheme() {
  const t = useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => theme,
  );
  return {
    ...t,
    setMode: (mode: Mode) => setTheme({ mode }),
    setAccent: (accent: Accent) => setTheme({ accent }),
  };
}
