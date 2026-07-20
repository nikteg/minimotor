import type { Server } from "node:http";
import { fileURLToPath } from "node:url";
import { defineConfig, type Plugin } from "vite";
import { WebSocketServer } from "ws";

const here = (path: string) => fileURLToPath(new URL(path, import.meta.url));

// Tiny WebSocket endpoints hosted by the dev/preview server itself, so the
// networking samples work offline (public echo servers come and go):
//   /ws-echo  — echoes every frame back to the sender (netws console)
//   /ws-relay — broadcasts every frame to every OTHER client (netgame)
// Vite's own HMR socket uses a different path/protocol and is untouched.
function attach(httpServer: Server | null): void {
  if (!httpServer) return;
  const echo = new WebSocketServer({ noServer: true });
  const relay = new WebSocketServer({ noServer: true });
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
  httpServer.on("upgrade", (req, socket, head) => {
    const path = req.url?.split("?")[0];
    const wss = path === "/ws-echo" ? echo : path === "/ws-relay" ? relay : null;
    if (!wss) return;
    wss.handleUpgrade(req, socket, head, (sock) => wss.emit("connection", sock, req));
  });
}

function sampleSockets(): Plugin {
  return {
    name: "minimotor-sample-sockets",
    configureServer(server) {
      attach(server.httpServer);
    },
    configurePreviewServer(server) {
      attach(server.httpServer);
    },
  };
}

// The samples live inside the engine package (packages/minimotor/samples) and
// serve as the showcase for the public API. Vite's root is the samples folder,
// so the gallery is at "/" and each game at "/<game>/". Game code imports the
// engine by its package name — `import { Minimotor } from "minimotor"` — which
// resolves via the alias below to the compiled build output, exactly matching
// what an external consumer writes.
export default defineConfig({
  root: here("./samples"),
  plugins: [sampleSockets()],
  resolve: {
    // Most-specific first: the plain "minimotor" entry must not swallow the
    // "/physics2d" subpath (string aliases also match "<find>/…" prefixes).
    alias: [
      { find: "minimotor/physics2d", replacement: here("./build/physics2d.js") },
      { find: "minimotor", replacement: here("./build/index.js") },
    ],
  },
  // Don't pre-bundle the engine so edits to its build output show up without
  // clearing Vite's dep cache.
  optimizeDeps: { exclude: ["minimotor"] },
  server: { port: 8765, strictPort: true },
  preview: { port: 8765, strictPort: true },
  build: {
    target: "es2020",
    outDir: here("./samples-dist"),
    emptyOutDir: true,
    rollupOptions: {
      input: {
        main: here("./samples/index.html"),
        scenes: here("./samples/scenes/index.html"),
        sprites: here("./samples/sprites/index.html"),
        minimal: here("./samples/minimal/index.html"),
        bounce: here("./samples/bounce/index.html"),
        breakout: here("./samples/breakout/index.html"),
        snake: here("./samples/snake/index.html"),
        platformer: here("./samples/platformer/index.html"),
        particles: here("./samples/particles/index.html"),
        physics: here("./samples/physics/index.html"),
        serverbrowser: here("./samples/serverbrowser/index.html"),
        tiles: here("./samples/tiles/index.html"),
        juice: here("./samples/juice/index.html"),
        swept: here("./samples/swept/index.html"),
        netgame: here("./samples/netgame/index.html"),
        netpeer: here("./samples/netpeer/index.html"),
        netws: here("./samples/netws/index.html"),
        synth: here("./samples/synth/index.html"),
        clockwork: here("./samples/clockwork/index.html"),
        camera: here("./samples/camera/index.html"),
        assetquest: here("./samples/assetquest/index.html"),
        pocket: here("./samples/pocket/index.html"),
        pixelAdventure: here("./samples/pixel-adventure/index.html"),
      },
    },
  },
});
