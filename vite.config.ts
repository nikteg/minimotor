import { readdirSync, readFileSync } from "node:fs";
import type { Server } from "node:http";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, type Plugin } from "vite";
import { WebSocketServer } from "ws";
import { createRoadRivalsServer } from "./samples/road-rivals/src/server/index.js";
import { signaling } from "./src/net/server/signaling.js";

const here = (path: string) => fileURLToPath(new URL(path, import.meta.url));

// Every `.html` under samples/ is a build entry — the gallery at the root plus
// one (or two, for the net client/host pages) per sample. Auto-discovered so a
// new sample is just a new folder: no hand-maintained input list to keep in
// sync (and nothing to forget). `_docs/` holds Markdown only, so nothing there
// matches anyway; node_modules is skipped defensively.
function samplePages(): Record<string, string> {
  const root = here("./samples");
  const html = readdirSync(root, { recursive: true, encoding: "utf8" })
    .map((p) => p.replaceAll("\\", "/")) // normalise Windows separators
    .filter(
      (p) =>
        p.endsWith(".html") &&
        !p.includes("node_modules") &&
        // `api/` is the generated TypeDoc-style reference (static HTML with its
        // own assets) — served/copied as-is, never a Vite entry.
        !p.startsWith("api/"),
    );
  return Object.fromEntries(html.map((p) => [p.replace(/\.html$/, ""), `${root}/${p}`]));
}

// Tiny WebSocket endpoints hosted by the dev/preview server itself, so the
// networking samples work offline (public echo servers come and go):
//   /ws-echo   — echoes every frame back to the sender (netws console)
//   /ws-relay  — broadcasts every frame to every OTHER client (netgame)
//   /ws-signal — WebRTC signaling relay for Net.host()/Net.join() (netrtc)
// Vite's own HMR socket uses a different path/protocol and is untouched.
function attach(httpServer: Server | null): void {
  if (!httpServer) return;
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

  httpServer.on("upgrade", (req, socket, head) => {
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

// Inject the landing page's code snippets from REAL, type-checked files in
// samples/_examples/ — so `<code data-example="tiles"></code>` is filled with
// the actual contents of samples/_examples/tiles.ts at dev-serve and build
// time. The examples are part of the `verify:samples` typecheck, so a broken
// snippet fails the build instead of shipping wrong code on the front page.
function landingExamples(): Plugin {
  const dir = here("./samples/_examples");
  const escapeHtml = (s: string) =>
    s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return {
    name: "minimotor-landing-examples",
    transformIndexHtml(html) {
      return html.replace(/<code data-example="([\w-]+)"><\/code>/g, (_m, name: string) => {
        const src = readFileSync(join(dir, `${name}.ts`), "utf8").replace(/\s+$/, "");
        return `<code data-example="${name}" data-lang="ts">${escapeHtml(src)}</code>`;
      });
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
  plugins: [sampleSockets(), landingExamples()],
  resolve: {
    // Most-specific first: the plain "minimotor" entry must not swallow the
    // "/physics2d" subpath (string aliases also match "<find>/…" prefixes).
    alias: [
      { find: "minimotor/physics2d", replacement: here("./build/physics2d.js") },
      { find: "minimotor/server", replacement: here("./build/server.js") },
      { find: "minimotor", replacement: here("./build/index.js") },
    ],
  },
  // Don't pre-bundle the engine so edits to its build output show up without
  // clearing Vite's dep cache.
  optimizeDeps: { exclude: ["minimotor"] },
  server: { host: true, port: 8765, strictPort: true },
  preview: { host: true, port: 8765, strictPort: true },
  build: {
    target: "es2020",
    outDir: here("./samples-dist"),
    emptyOutDir: true,
    rollupOptions: {
      input: samplePages(),
    },
  },
});
