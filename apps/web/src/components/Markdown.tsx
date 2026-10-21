import ReactMarkdown, { type Components } from "react-markdown";

// Raw HTML (and HTML comments) is left out, not shown as text. Relative images can't be served, so they
// are dropped; links open in a new tab.
const components: Components = {
  h1: (p) => <h3 className="text-lg font-semibold" {...p} />,
  h2: (p) => <h3 className="text-base font-semibold" {...p} />,
  h3: (p) => <h4 className="font-semibold" {...p} />,
  h4: (p) => <h4 className="font-semibold" {...p} />,
  ul: (p) => <ul className="list-disc pl-6" {...p} />,
  ol: (p) => <ol className="list-decimal pl-6" {...p} />,
  a: ({ node: _, ...p }) => (
    <a className="text-accent underline" target="_blank" rel="noopener noreferrer" {...p} />
  ),
  code: (p) => <code className="rounded bg-surface-2 px-1 font-mono text-sm" {...p} />,
  pre: (p) => <pre className="overflow-x-auto rounded-md bg-surface-2 p-3" {...p} />,
  blockquote: (p) => <blockquote className="border-l-2 border-border pl-3 text-muted" {...p} />,
  img: () => null,
};

export function Markdown({ children }: { children: string }) {
  return (
    <div className="grid gap-2">
      <ReactMarkdown components={components} skipHtml>
        {children}
      </ReactMarkdown>
    </div>
  );
}
