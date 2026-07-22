// WebSocket sidecar for the built samples showcase — ONLY the networking
// endpoints (/ws-echo, /ws-relay, /ws-signal, /ws-road-rivals) plus a /healthz
// liveness probe. Static files are served by nginx (see tools/nginx.conf); this
// process handles nothing but socket upgrades. Compiled with its import graph by
// tsc to plain ESM under server-dist/ (`pnpm run server:build`); the sidecar
// image runs `node server-dist/tools/serve.js` with only `ws` in node_modules.
import { createServer, type Server } from "node:http";
import { WebSocketServer } from "ws";
import { createRoadRivalsServer } from "../samples/road-rivals/src/server/index.js";
import { signaling } from "../src/net/server/signaling.js";

const PORT = Number(process.env.PORT ?? 8765);

const http: Server = createServer((req, res) => {
  // Only a liveness probe answers over plain HTTP; every other path expects a
  // WebSocket upgrade (handled below), so a plain GET gets 426.
  if ((req.url ?? "/").split("?")[0] === "/healthz") {
    res.writeHead(200, { "content-type": "text/plain" }).end("ok");
    return;
  }
  res.writeHead(426, { "content-type": "text/plain" }).end("Upgrade Required");
});

attachSockets(http);
http.listen(PORT, () => console.log(`minimotor ws sidecar → http://0.0.0.0:${PORT}`));

// The same WebSocket endpoints the Vite dev/preview server hosts, so the
// networking samples work against this server too.
function attachSockets(server: Server): void {
  const echo = new WebSocketServer({ noServer: true });
  const relay = new WebSocketServer({ noServer: true });
  const signal = new WebSocketServer({ noServer: true });
  signaling(signal);
  const road = createRoadRivalsServer();

  echo.on("connection", (sock) => {
    sock.on("message", (data, isBinary) => sock.send(data, { binary: isBinary }));
  });
  relay.on("connection", (sock) => {
    sock.on("message", (data, isBinary) => {
      for (const client of relay.clients) {
        if (client !== sock && client.readyState === 1) client.send(data, { binary: isBinary });
      }
    });
  });

  server.on("upgrade", (req, socket, head) => {
    const path = req.url?.split("?")[0];
    const wss =
      path === "/ws-echo"
        ? echo
        : path === "/ws-relay"
          ? relay
          : path === "/ws-signal"
            ? signal
            : path === "/ws-road-rivals"
              ? road
              : null;
    if (!wss) return socket.destroy();
    wss.handleUpgrade(req, socket, head, (sock) => wss.emit("connection", sock, req));
  });
}
