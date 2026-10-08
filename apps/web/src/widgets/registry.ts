import type { ComponentType } from "react";
import type { z } from "zod";

/** A setting the layout editor renders. Labels are i18n keys. */
export type WidgetField =
  | { key: string; label: string; kind: "number"; min: number; max: number }
  | { key: string; label: string; kind: "select"; options: { value: string; label: string }[] };

export type WidgetDef<S extends z.ZodObject = z.ZodObject> = {
  /** Stored in the layout; never rename once shipped. */
  type: string;
  /** i18n key. */
  title: string;
  /** Grid columns on a wide screen: a stat card is 1, a list 2, a chart 4. */
  span: 1 | 2 | 4;
  /** Validates and defaults the stored settings; every key needs a default. */
  settings: S;
  fields: WidgetField[];
  Component: ComponentType<{ settings: z.infer<S> }>;
};

const registry = new Map<string, WidgetDef>();

/** Call once at the top level of a `*.widget.tsx` file; the file is picked up by `widgets/index.ts`. */
export function defineWidget<S extends z.ZodObject>(def: WidgetDef<S>) {
  registry.set(def.type, def as unknown as WidgetDef);
}

export const getWidget = (type: string) => registry.get(type);
export const allWidgets = () => [...registry.values()];
