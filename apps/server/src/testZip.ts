import yauzl from "yauzl";

/** A zip's entries and their text, for tests. */
export const unzip = (body: Buffer) =>
  new Promise<Record<string, string>>((resolve, reject) =>
    yauzl.fromBuffer(body, { lazyEntries: true }, (err, zip) => {
      if (err || !zip) return reject(err);
      const out: Record<string, string> = {};
      zip.on("entry", (e: yauzl.Entry) =>
        zip.openReadStream(e, async (err2, s) => {
          if (err2 || !s) return reject(err2);
          const parts: Buffer[] = [];
          for await (const c of s) parts.push(c as Buffer);
          out[e.fileName] = Buffer.concat(parts).toString();
          zip.readEntry();
        }),
      );
      zip.on("end", () => resolve(out));
      zip.readEntry();
    }),
  );
