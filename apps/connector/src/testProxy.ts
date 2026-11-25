// Tests only: another address for the same hub, closed to play the hub moving away from it.
import { type AddressInfo, connect, createServer, type Socket } from "node:net";

/** A TCP proxy on a free port of 127.0.0.1 to `target` (`http://host:port`). */
export async function tcpProxy(target: string) {
  const { hostname, port } = new URL(target);
  const sockets = new Set<Socket>();
  const server = createServer((client) => {
    const upstream = connect(Number(port), hostname);
    sockets.add(client).add(upstream);
    const drop = () => {
      client.destroy();
      upstream.destroy();
      sockets.delete(client);
      sockets.delete(upstream);
    };
    client.on("error", drop).on("close", drop);
    upstream.on("error", drop).on("close", drop);
    client.pipe(upstream).pipe(client);
  });
  await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
  const { port: own } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${own}`,
    /** Nothing answers there any more, open connections included. */
    close: () =>
      new Promise<void>((done) => {
        for (const s of sockets) s.destroy();
        server.close(() => done());
      }),
  };
}
