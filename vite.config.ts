import { readdirSync, readFileSync } from "node:fs";
import type { Server } from "node:http";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, type Plugin } from "vite";
import { WebSocketServer } from "ws";
import { createRoadRivalsServer } from "./samples/road-rivals/src/server/index.js";
import { signaling } from "./src/net/server/signaling.js";
import { rooms } from "./src/net/server/rooms.js";

const here = (path: string) => fileURLToPath(new URL(path, import.meta.url));

// Game code imports the engine by its package name, exactly as an external
// consumer writes it; development aliases point those names at TypeScript
// source so Vite can transform and HMR the engine without a preceding tsc.
// Read straight from `exports` so moving a public subpath is a one-file change.
function subpathAliases(): { find: string; replacement: string }[] {
  const pkg = JSON.parse(readFileSync(here("./package.json"), "utf8")) as {
    exports: Record<string, { default: string }>;
  };
  return (
    Object.entries(pkg.exports)
      // The `mm` tool is Node-only and `./cli/*` is a wildcard: neither is
      // something a sample can import.
      .filter(([subpath]) => !subpath.startsWith("./cli"))
      .map(([subpath, entry]) => ({
        find: "minimotor" + subpath.slice(1),
        replacement: here(entry.default.replace(/^\.\/build\//, "./src/").replace(/\.js$/, ".ts")),
      }))
      // Most-specific first: the plain "minimotor" entry must not swallow the
      // "/physics2d" subpath (string aliases also match "<find>/…" prefixes).
      .sort((a, b) => b.find.length - a.find.length)
  );
}

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
  const roomServer = new WebSocketServer({ noServer: true });
  rooms(roomServer);
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
            : path === "/ws-rooms"
              ? roomServer
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
// engine by its package name — `import { createApp } from "minimotor"` — which
// resolves via the alias below to source during development. Vite transforms
// the TypeScript directly, so changing `src/` no longer requires rebuilding
// `build/` first.
// The aliases above are computed ONCE, when the config loads. Vite watches
// `vite.config.ts` and restarts on changes to it, but it has no idea this
// config read `package.json` — so adding or renaming a subpath there leaves a
// running dev server serving yesterday's alias table, and the import fails with
// "Failed to resolve import" for a path that is plainly in `exports`. Watch the
// file we actually derived from and restart when it moves.
function watchPackageExports(): Plugin {
  return {
    name: "minimotor-watch-package-exports",
    configureServer(server) {
      const pkg = here("./package.json");
      server.watcher.add(pkg);
      server.watcher.on("change", (file) => {
        if (file === pkg) void server.restart();
      });
    },
  };
}

export default defineConfig({
  root: here("./samples"),
  plugins: [sampleSockets(), landingExamples(), watchPackageExports()],
  resolve: {
    // Derived from the package's own `exports` map rather than restated here:
    // a hand-kept copy is a third place every subpath has to be spelled (after
    // package.json and samples/tsconfig.json) and the one nobody notices has
    // gone stale, since a wrong alias still resolves — to yesterday's module.
    alias: [{ find: /^@src\/(.*)$/, replacement: `${here("./src")}/$1` }, ...subpathAliases()],
  },
  // Don't pre-bundle the engine so source edits flow through Vite's normal
  // module graph and HMR path.
  optimizeDeps: { exclude: ["minimotor"] },
  server: { host: true, port: 8765, strictPort: true },
  preview: { host: true, port: 8765, strictPort: true },
  build: {
    // Several samples intentionally use top-level await for startup resources.
    // ES2022 is the first standard target that includes it.
    target: "es2022",
    outDir: here("./samples-dist"),
    emptyOutDir: true,
    rollupOptions: {
      input: samplePages(),
    },
  },
});
