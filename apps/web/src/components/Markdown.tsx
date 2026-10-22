import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";

/** Turns a relative link or image path into a URL the app serves; null when it can't. */
export type MarkdownResolve = (src: string, kind: "image" | "link") => string | null;

const EXTERNAL = /^(https?:|mailto:)/i;

/**
 * GitHub-flavoured markdown (tables, task lists, strikethrough, autolinks). Raw HTML (and HTML
 * comments) is left out, not shown as text. Web links open in a new tab; relative images and
 * links go through `resolve` and are dropped (images) or shown as plain text (links) without it.
 */
function components(resolve?: MarkdownResolve): Components {
  return {
    h1: ({ node: _, ...p }) => <h3 className="mt-2 text-lg font-semibold" {...p} />,
    h2: ({ node: _, ...p }) => <h3 className="mt-2 text-base font-semibold" {...p} />,
    h3: ({ node: _, ...p }) => <h4 className="mt-2 font-semibold" {...p} />,
    h4: ({ node: _, ...p }) => <h4 className="mt-2 font-semibold" {...p} />,
    ul: ({ node: _, ...p }) => <ul className="list-disc pl-6" {...p} />,
    ol: ({ node: _, ...p }) => <ol className="list-decimal pl-6" {...p} />,
    hr: () => <hr className="border-border" />,
    a: ({ node: _, href = "", ...p }) => {
      if (href.startsWith("#")) return <a className="text-accent underline" href={href} {...p} />;
      const url = EXTERNAL.test(href) ? href : (resolve?.(href, "link") ?? null);
      if (!url) return <span {...p} />;
      return (
        <a
          className="text-accent underline"
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          {...p}
        />
      );
    },
    img: ({ node: _, src, alt }) => {
      const s = typeof src === "string" ? src : "";
      const url = /^https?:/i.test(s) ? s : (resolve?.(s, "image") ?? null);
      return url ? (
        <img
          src={url}
          alt={alt ?? ""}
          loading="lazy"
          className="inline h-auto max-w-full rounded"
        />
      ) : null;
    },
    code: ({ node: _, ...p }) => (
      <code className="rounded bg-surface-2 px-1 font-mono text-sm" {...p} />
    ),
    // Block code: no inline-code chip inside.
    pre: ({ node: _, ...p }) => (
      <pre
        className="overflow-x-auto rounded-md bg-surface-2 p-3 [&_code]:bg-transparent [&_code]:p-0"
        {...p}
      />
    ),
    blockquote: ({ node: _, ...p }) => (
      <blockquote className="border-l-2 border-border pl-3 text-muted" {...p} />
    ),
    table: ({ node: _, ...p }) => (
      <div className="overflow-x-auto">
        <table className="w-full border-collapse text-sm" {...p} />
      </div>
    ),
    th: ({ node: _, ...p }) => (
      <th className="border border-border bg-surface-2 px-2 py-1 text-left font-semibold" {...p} />
    ),
    td: ({ node: _, ...p }) => <td className="border border-border px-2 py-1 align-top" {...p} />,
    input: ({ node: _, ...p }) => <input {...p} className="mr-1 align-middle" />,
  };
}

export function Markdown({ children, resolve }: { children: string; resolve?: MarkdownResolve }) {
  return (
    <div className="grid min-w-0 gap-2 [overflow-wrap:anywhere]">
      <ReactMarkdown components={components(resolve)} remarkPlugins={[remarkGfm]} skipHtml>
        {children}
      </ReactMarkdown>
    </div>
  );
}
