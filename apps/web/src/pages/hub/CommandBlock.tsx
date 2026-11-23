import { CopyButton } from "../../components/CopyButton.tsx";

/** Text to copy and paste into a terminal or a file: selectable, scrolls sideways, a Copy button. */
export function CommandBlock({
  text,
  copyLabel,
  name,
}: {
  text: string;
  copyLabel: string;
  /** What it is, for a screen reader. */
  name: string;
}) {
  return (
    <div className="grid gap-2">
      <pre
        title={name}
        className="select-all overflow-x-auto rounded-md border border-border bg-surface-2 p-3 font-mono text-sm whitespace-pre"
      >
        {text}
      </pre>
      <div className="justify-self-start">
        <CopyButton value={text} label={copyLabel} />
      </div>
    </div>
  );
}
