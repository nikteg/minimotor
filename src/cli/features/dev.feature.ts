import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { defineFeature } from "../feature.js";
import { numberOption, takeFlag, takeOption } from "../utils.js";

const help = `Start a LAN-ready game development session

Usage:
  mm dev [directory] [options]

Options:
  --host <host>       Vite host. Default 0.0.0.0
  --port <port>       Vite port. Default 5173
  --open              Open the game in a browser.
  --relay <command>   Start a relay/server command beside Vite.

If package.json defines "dev:server", it is used as the relay automatically.
`;

function automaticRelay(root: string): string | undefined {
  const path = resolve(root, "package.json");
  if (!existsSync(path)) return undefined;
  const pkg = JSON.parse(readFileSync(path, "utf8")) as {
    scripts?: Record<string, string>;
  };
  return pkg.scripts?.["dev:server"] ? "pnpm dev:server" : undefined;
}

function stop(children: ChildProcess[]): void {
  for (const child of children) {
    if (!child.killed) child.kill("SIGTERM");
  }
}

export default defineFeature({
  name: "dev",
  summary: "Start a LAN-ready Vite game and optional relay.",
  usage: ["mm dev [directory] [--relay <command>]"],
  async run(input) {
    if (input[0] === "-h" || input[0] === "--help") {
      process.stdout.write(help);
      return;
    }
    const args = [...input];
    const host = takeOption(args, "--host") ?? "0.0.0.0";
    const port = numberOption(args, 5173, "--port");
    const open = takeFlag(args, "--open");
    const directory = resolve(args.find((arg) => !arg.startsWith("-")) ?? ".");
    const directoryIndex = args.findIndex((arg) => !arg.startsWith("-"));
    if (directoryIndex >= 0) args.splice(directoryIndex, 1);
    const relay = takeOption(args, "--relay") ?? automaticRelay(directory);
    if (args.length) throw new Error(`unknown option "${args[0]}"`);
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      throw new Error("--port must be an integer from 1 to 65535");
    }

    const viteArgs = ["--host", host, "--port", String(port)];
    if (open) viteArgs.push("--open");
    const children = [
      spawn("vite", viteArgs, { cwd: directory, stdio: "inherit" }),
      ...(relay ? [spawn(relay, { cwd: directory, stdio: "inherit", shell: true })] : []),
    ];
    const onSignal = () => stop(children);
    process.once("SIGINT", onSignal);
    process.once("SIGTERM", onSignal);
    try {
      await Promise.race(
        children.map(
          (child) =>
            new Promise<void>((resolve, reject) => {
              child.once("error", reject);
              child.once("exit", (code, signal) => {
                if (code === 0 || signal === "SIGTERM") resolve();
                else reject(new Error(`development process exited ${signal ?? code}`));
              });
            }),
        ),
      );
    } finally {
      stop(children);
      process.off("SIGINT", onSignal);
      process.off("SIGTERM", onSignal);
    }
  },
});
