import { Check } from "lucide-react";
import {
  Fragment,
  type KeyboardEvent,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";
import { useTranslation } from "react-i18next";
import { cx } from "../lib/cx.ts";
import { placePopover } from "../lib/placePopover.ts";
import { inputClass } from "./FormField.tsx";

export type ComboOption = { value: string; label: string; group?: string; disabled?: boolean };

const filter = (options: ComboOption[], q: string) => {
  const needle = q.trim().toLowerCase();
  return needle ? options.filter((o) => o.label.toLowerCase().includes(needle)) : options;
};

/** Next enabled index from `i` in direction `d`, or `i` when there is none. */
const step = (list: ComboOption[], i: number, d: 1 | -1) => {
  for (let j = i + d; j >= 0 && j < list.length; j += d) if (!list[j]?.disabled) return j;
  return i;
};

/**
 * Single select with type-to-filter: the APG editable combobox with list autocomplete. A drop-in
 * for `<select>`: controlled (`value`/`onChange`) or uncontrolled (`name`/`defaultValue`, read with
 * FormData). The list is a manual popover, so tables don't clip it and it sits above modal dialogs.
 * `free`: a name typed that isn't listed is a value too (offered first, kept on blur); controlled only.
 */
export function Combobox({
  options: listed,
  value,
  defaultValue,
  onChange,
  name,
  required,
  disabled,
  placeholder,
  free,
  className = inputClass,
  ...aria
}: {
  options: ComboOption[];
  value?: string;
  defaultValue?: string;
  onChange?: (value: string) => void;
  name?: string;
  required?: boolean;
  disabled?: boolean;
  placeholder?: string;
  free?: boolean;
  className?: string;
  id?: string;
  "aria-label"?: string;
  "aria-describedby"?: string;
  "aria-invalid"?: boolean;
}) {
  const { t } = useTranslation();
  const listId = useId();
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const [inner, setInner] = useState(defaultValue);
  // A changed defaultValue re-seeds the pick (a row just created in a modal), even after a remount.
  const [seed, setSeed] = useState(defaultValue);
  if (defaultValue !== seed) {
    setSeed(defaultValue);
    setInner(defaultValue);
  }
  const [query, setQuery] = useState<string | null>(null); // null: not filtering, show the selection
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  // Free: the value itself when it isn't listed, and what is typed when nothing listed is named so.
  const typed = query?.trim() ?? "";
  const named = (v: string) => listed.some((o) => o.label.toLowerCase() === v.toLowerCase());
  const options = free
    ? [
        ...(typed && !named(typed) ? [{ value: typed, label: typed }] : []),
        ...(value && !listed.some((o) => o.value === value) ? [{ value, label: value }] : []),
        ...listed,
      ]
    : listed;

  // Like a native select, an uncontrolled value that matches no option falls back to the first one.
  const current =
    value ?? (options.some((o) => o.value === inner) ? (inner ?? "") : (options[0]?.value ?? ""));
  const selected = options.find((o) => o.value === current);
  const shown = filter(options, query ?? "");
  const emptyLabel = options.find((o) => o.value === "")?.label;
  // A required empty value shows as a placeholder, so the browser's own `required` check applies.
  const text = query ?? (required && !current ? "" : (selected?.label ?? ""));

  const close = () => {
    setOpen(false);
    setQuery(null);
    setActive(-1);
  };
  const openList = () => {
    if (open) return;
    setOpen(true);
    setActive(Math.max(0, options.indexOf(selected as ComboOption)));
  };
  const pick = (o: ComboOption | undefined) => {
    if (o && !o.disabled) {
      if (value === undefined) setInner(o.value);
      if (o.value !== current) onChange?.(o.value);
    }
    close();
  };

  useLayoutEffect(() => {
    const el = list.current;
    if (!el || !input.current) return;
    if (open !== el.matches(":popover-open")) el.togglePopover(open);
    if (!open) return;
    placePopover(input.current, el, true);
    el.querySelector("[data-active]")?.scrollIntoView({ block: "nearest" });
  });
  useEffect(() => {
    if (!open) return;
    const place = () =>
      list.current && input.current && placePopover(input.current, list.current, true);
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    return () => {
      window.removeEventListener("scroll", place, true);
      window.removeEventListener("resize", place);
    };
  }, [open]);

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    const move = (d: 1 | -1) => {
      e.preventDefault();
      if (open) setActive((i) => step(shown, i, d));
      else openList();
    };
    switch (e.key) {
      case "ArrowDown":
        if (e.altKey) {
          e.preventDefault();
          openList();
        } else move(1);
        break;
      case "ArrowUp":
        if (e.altKey && open) {
          e.preventDefault();
          pick(shown[active]);
        } else move(-1);
        break;
      case "Enter":
        if (!open) break;
        e.preventDefault(); // pick, don't submit the form
        pick(shown[active]);
        break;
      case "Escape":
        if (!open) break; // let a surrounding dialog or popover close
        e.preventDefault();
        e.stopPropagation();
        close();
        break;
      case "Tab":
        if (open) pick(shown[active]); // focus moves on as usual
        break;
    }
  };

  // Options arrive sorted by group; consecutive runs become one role="group".
  const groups: { label?: string; items: { o: ComboOption; i: number }[] }[] = [];
  shown.forEach((o, i) => {
    const last = groups.at(-1);
    if (last && last.label === o.group) last.items.push({ o, i });
    else groups.push({ label: o.group, items: [{ o, i }] });
  });
  const optionId = (i: number) => `${listId}-${i}`;

  return (
    <>
      <input
        {...aria}
        ref={input}
        type="text"
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={open && shown[active] ? optionId(active) : undefined}
        autoComplete="off"
        spellCheck={false}
        disabled={disabled}
        required={required}
        placeholder={placeholder ?? emptyLabel}
        size={Math.max(4, ...options.map((o) => o.label.length))}
        value={text}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
          const next = filter(options, e.target.value);
          setActive(next[0]?.disabled ? step(next, 0, 1) : 0);
        }}
        onKeyDown={onKeyDown}
        onFocus={(e) => e.currentTarget.select()}
        onClick={(e) => {
          if (open) return;
          e.currentTarget.select(); // after mouseup, which would otherwise drop the focus selection
          openList();
        }}
        onBlur={() => {
          // Free: what was typed stays, like a text field.
          if (free && query !== null && typed !== current) onChange?.(typed);
          close();
        }}
        className={cx(className, "pr-8 text-ellipsis")}
      />
      {name && <input type="hidden" name={name} value={current} disabled={disabled} />}
      {/* biome-ignore lint/a11y/noStaticElementInteractions lint/a11y/useKeyWithClickEvents: mouse-only guards; the keyboard stays in the input */}
      <div
        ref={list}
        popover="manual"
        // Keep focus in the input while clicking options or the scrollbar.
        onMouseDown={(e) => e.preventDefault()}
        // Inside a <label>, a click here would otherwise be forwarded to the input and reopen the list.
        onClick={(e) => e.preventDefault()}
        className="fixed inset-auto m-0 max-h-64 max-w-[calc(100vw-1rem)] overflow-y-auto rounded-md border border-border bg-surface py-1 text-fg shadow-lg"
      >
        <div id={listId} role="listbox">
          {groups.map((g, gi) => {
            const items = g.items.map(({ o, i }) => (
              // biome-ignore lint/a11y/useFocusableInteractive lint/a11y/useKeyWithClickEvents: APG pattern, options are reached through aria-activedescendant
              <div
                key={`${o.value}-${i}`}
                id={optionId(i)}
                role="option"
                aria-selected={i === active}
                aria-disabled={o.disabled || undefined}
                data-active={i === active || undefined}
                onClick={() => pick(o)}
                onMouseMove={() => !o.disabled && i !== active && setActive(i)}
                className={cx(
                  "flex cursor-default items-center gap-2 px-3 py-1.5",
                  i === active && "bg-surface-2",
                  o.disabled && "text-muted",
                )}
              >
                <Check
                  aria-hidden
                  className={cx("size-4 shrink-0", o.value !== current && "invisible")}
                />
                {o.label}
              </div>
            ));
            if (!g.label) return <Fragment key={`g${gi}`}>{items}</Fragment>;
            const headId = `${listId}-g${gi}`;
            return (
              // biome-ignore lint/a11y/useSemanticElements: a fieldset is not allowed inside a listbox
              <div key={headId} role="group" aria-labelledby={headId}>
                <div id={headId} className="px-3 pt-2 pb-1 font-medium text-muted text-xs">
                  {g.label}
                </div>
                {items}
              </div>
            );
          })}
        </div>
        <p role="status" className={cx("text-muted", shown.length === 0 && "px-3 py-1.5")}>
          {shown.length === 0 && t("common:picker.none")}
        </p>
      </div>
    </>
  );
}
