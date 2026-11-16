import { createSocket, type Socket } from "node:dgram";
import { networkInterfaces } from "node:os";

// A Bambu printer announces itself every 10 s on UDP 2021 and 1990 (fixtures/lan/ssdp-notify.txt):
// its IP, serial, model code and name. Listening is all it takes; nothing is sent. It doesn't
// reach a server in a bridged Docker network, so the host field stays (ADR-0015).

export interface Announce {
  serial: string;
  host: string;
  /** Bambu's code: "N2S" is the A1. */
  modelCode?: string;
  name?: string;
}

/** The printer's NOTIFY, or undefined for anything else on the port. */
export function parseNotify(text: string): Announce | undefined {
  if (!text.includes("urn:bambulab-com:device:3dprinter:1")) return;
  const h = (k: string) => new RegExp(`^${k}:[ \\t]*(.*?)\\s*$`, "mi").exec(text)?.[1] || undefined;
  const serial = h("USN");
  const host = h("Location");
  if (!serial || !host) return;
  return { serial, host, modelCode: h("DevModel\\.bambu\\.com"), name: h("DevName\\.bambu\\.com") };
}

const PORTS = [2021, 1990];
type Listener = (a: Announce) => void;
const listeners = new Set<Listener>();
let sockets: Socket[] = [];
/** The latest announce of each printer heard while anyone listens, by serial. */
const seen = new Map<string, Announce>();

function open(warn: (port: number, code?: string) => void) {
  sockets = PORTS.map((port) => {
    const s = createSocket({ type: "udp4", reuseAddr: true });
    // Bambu Studio on the same machine listens too: sharing the port is fine, failing to is not fatal.
    s.on("error", (e: NodeJS.ErrnoException) => {
      warn(port, e.code);
      s.close();
    });
    s.on("message", (buf) => {
      const a = parseNotify(buf.toString("utf8"));
      if (!a) return;
      seen.set(a.serial, a);
      for (const l of listeners) l(a);
    });
    s.bind(port, () => {
      for (const i of Object.values(networkInterfaces()).flat())
        if (i && i.family === "IPv4" && !i.internal)
          try {
            s.addMembership("239.255.255.250", i.address);
          } catch {
            // An interface without multicast still gets the broadcast.
          }
    });
    s.unref();
    return s;
  });
}

/**
 * Calls `l` with every announce until the returned function is called, starting with the latest
 * one of each printer already heard. One socket per port, shared.
 */
export function watchPrinters(l: Listener, warn: (port: number, code?: string) => void = () => {}) {
  if (!listeners.size) open(warn);
  listeners.add(l);
  for (const a of seen.values()) l(a);
  return () => {
    listeners.delete(l);
    if (listeners.size) return;
    seen.clear();
    for (const s of sockets)
      try {
        s.close();
      } catch {
        // Closed after an error.
      }
    sockets = [];
  };
}
