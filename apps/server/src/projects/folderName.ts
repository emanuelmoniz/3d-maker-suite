// "001_aquaterrario", "12 - Vase", "7.Cat": a number, a separator, then the name.
const PREFIX = /^(\d+)[\s._-]+(.+)$/;

/** A project folder's number (null without a prefix) and its name without the prefix. */
export function parseFolderName(base: string): { number: number | null; name: string } {
  const m = PREFIX.exec(base);
  return m ? { number: Number(m[1]), name: m[2] as string } : { number: null, name: base };
}
