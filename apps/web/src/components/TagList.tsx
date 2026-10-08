import type { Tag } from "@3d-maker-suite/core";

export function TagChip({ tag }: { tag: Tag }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-border px-2 py-0.5 text-xs">
      <span
        aria-hidden="true"
        className="size-2.5 rounded-full"
        style={{ backgroundColor: tag.color }}
      />
      {tag.name}
    </span>
  );
}

export const TagList = ({ tags }: { tags: Tag[] }) => (
  <span className="flex flex-wrap gap-1">
    {tags.map((t) => (
      <TagChip key={t.id} tag={t} />
    ))}
  </span>
);
