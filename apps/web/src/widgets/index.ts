// Every `*.widget.tsx` registers itself on import, so adding a widget is adding a file.
import.meta.glob("./*.widget.tsx", { eager: true });

export * from "./registry.ts";
