import { connect, type TLSSocket } from "node:tls";
import { IntegrationError } from "@3d-maker-suite/core";

// The few FTP commands it takes to read one file from a Bambu printer: implicit TLS on 990, the
// same sign-in as MQTT, passive mode, a private data channel on the control channel's TLS session.
// Read-only: RETR is the only file command sent. Node has no FTP client and this is all we need,
// so no dependency (ADR-0015 names `mqtt` as the only one).

const PORT = 990;
const TIMEOUT_MS = 60_000;
/** A job file is a few MB at most (532 KB in Step 1). */
const MAX_BYTES = 64 * 1024 * 1024;

type Reply = { code: number; text: string };

function replies(socket: TLSSocket) {
  let buf = "";
  const queue: Reply[] = [];
  let wake: (() => void) | undefined;
  let failed: Error | undefined;
  socket.setEncoding("utf8");
  socket.on("data", (chunk: string) => {
    buf += chunk;
    // A reply ends on "123 text"; "123-text" lines continue it.
    for (let m = /^(\d{3}) [^\r\n]*\r?\n/m.exec(buf); m; m = /^(\d{3}) [^\r\n]*\r?\n/m.exec(buf)) {
      queue.push({ code: Number(m[1]), text: buf.slice(0, m.index + m[0].length) });
      buf = buf.slice(m.index + m[0].length);
    }
    wake?.();
  });
  const fail = (e: Error) => {
    failed = e;
    wake?.();
  };
  socket.on("error", fail);
  socket.on("close", () => fail(new Error("closed")));
  return async (): Promise<Reply> => {
    for (;;) {
      const next = queue.shift();
      if (next) return next;
      if (failed) throw failed;
      await new Promise<void>((r) => {
        wake = r;
      });
      wake = undefined;
    }
  };
}

/**
 * The whole file at `path` (FTPS refuses an offset, so never a part). Undefined when there is no
 * such file. Throws `auth_required` for a wrong access code, `unreachable` otherwise.
 */
export async function download(
  host: string,
  accessCode: string,
  path: string,
  signal: AbortSignal,
): Promise<Buffer | undefined> {
  const abort = AbortSignal.any([signal, AbortSignal.timeout(TIMEOUT_MS)]);
  // The printer's certificate is signed by Bambu's own CA, not one Node knows.
  const control = connect({ host, port: PORT, rejectUnauthorized: false });
  let data: TLSSocket | undefined;
  const stop = () => {
    control.destroy();
    data?.destroy();
  };
  abort.addEventListener("abort", stop, { once: true });
  try {
    const next = replies(control);
    const send = async (line: string, ok: (code: number) => boolean) => {
      control.write(`${line}\r\n`);
      const r = await next();
      if (!ok(r.code)) throw r;
      return r;
    };
    const hello = await next();
    if (hello.code !== 220) throw hello;
    await send("USER bblp", (c) => c === 331 || c === 230);
    await send(`PASS ${accessCode}`, (c) => c === 230);
    await send("PBSZ 0", (c) => c === 200);
    await send("PROT P", (c) => c === 200);
    await send("TYPE I", (c) => c === 200);
    const pasv = await send("PASV", (c) => c === 227);
    const n = /(\d+),(\d+),(\d+),(\d+),(\d+),(\d+)/.exec(pasv.text);
    if (!n) throw pasv;
    // The printer's own address, not the one in the reply: it may sit behind a NAT.
    const port = Number(n[5]) * 256 + Number(n[6]);
    const socket = connect({
      host,
      port,
      rejectUnauthorized: false,
      session: control.getSession(),
    });
    data = socket;
    const chunks: Buffer[] = [];
    let size = 0;
    const body = new Promise<Buffer>((resolve, reject) => {
      socket.on("data", (c: Buffer) => {
        size += c.length;
        if (size > MAX_BYTES) socket.destroy(new Error("too big"));
        else chunks.push(c);
      });
      socket.on("end", () => resolve(Buffer.concat(chunks)));
      socket.on("error", reject);
    });
    body.catch(() => {});
    // The server starts TLS on the data channel once it has the command.
    const retr = await send(`RETR ${path}`, (c) => c === 150 || c === 125 || c === 550);
    if (retr.code === 550) return undefined;
    const file = await body;
    const done = await next();
    if (done.code !== 226) throw done;
    control.write("QUIT\r\n");
    return file;
  } catch (e) {
    if (e && typeof e === "object" && "code" in e && (e as Reply).code === 530)
      throw new IntegrationError("auth_required");
    if (e instanceof IntegrationError) throw e;
    throw new IntegrationError("unreachable");
  } finally {
    abort.removeEventListener("abort", stop);
    stop();
  }
}
