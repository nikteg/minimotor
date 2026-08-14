import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { dirname, extname, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { createLevelTesterServer } from "./server.js";
const defaultModuleRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const page = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Minimotor Level Tester</title>
    <style>
      html, body { margin: 0; width: 100%; height: 100%; overflow: hidden; background: #111827; }
      canvas { display: block; }
    </style>
  </head>
  <body>
    <canvas id="game"></canvas>
    <script type="module" src="/modules/cli/level-tester/client.js"></script>
  </body>
</html>
`;
const contentTypes = {
    ".js": "text/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".map": "application/json; charset=utf-8",
};
/** Start the dependency-free HTTP/WebSocket level tester shipped with the CLI. */
export async function startStandaloneLevelTester(options) {
    const host = options.host ?? "127.0.0.1";
    const moduleRoot = resolve(options.moduleRoot ?? defaultModuleRoot);
    const tester = createLevelTesterServer(options.ratingsPath);
    const server = createServer((request, response) => {
        const pathname = new URL(request.url ?? "/", "http://localhost").pathname;
        if (pathname === "/" || pathname === "/index.html") {
            response.writeHead(200, {
                "content-type": "text/html; charset=utf-8",
                "cache-control": "no-store",
            });
            response.end(page);
            return;
        }
        if (pathname === "/favicon.ico") {
            response.writeHead(204).end();
            return;
        }
        if (!pathname.startsWith("/modules/")) {
            response.writeHead(404).end("Not found");
            return;
        }
        const relative = decodeURIComponent(pathname.slice("/modules/".length));
        const path = resolve(moduleRoot, relative);
        if (!path.startsWith(`${moduleRoot}${sep}`) || !existsSync(path) || !statSync(path).isFile()) {
            response.writeHead(404).end("Not found");
            return;
        }
        response.writeHead(200, {
            "content-type": contentTypes[extname(path)] ?? "application/octet-stream",
            "cache-control": "no-store",
        });
        createReadStream(path).pipe(response);
    });
    server.on("upgrade", (request, socket, head) => {
        if (new URL(request.url ?? "/", "http://localhost").pathname !== "/ws-level-tester") {
            socket.destroy();
            return;
        }
        tester.handleUpgrade(request, socket, head, (client) => {
            tester.emit("connection", client, request);
        });
    });
    await new Promise((resolveListen, reject) => {
        server.once("error", reject);
        server.listen(options.port ?? 4177, host, () => {
            server.off("error", reject);
            resolveListen();
        });
    });
    const address = server.address();
    if (!address || typeof address === "string")
        throw new Error("level tester has no TCP address");
    const displayHost = host === "0.0.0.0" || host === "::" ? "localhost" : host;
    return {
        server,
        url: `http://${displayHost}:${address.port}/`,
        async close() {
            for (const client of tester.clients)
                client.close();
            tester.close();
            await new Promise((resolveClose, reject) => server.close((error) => (error ? reject(error) : resolveClose())));
        },
    };
}
