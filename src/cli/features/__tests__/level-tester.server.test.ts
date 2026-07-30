import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { startStandaloneLevelTester } from "../../level-tester/standalone.js";

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("level tester server", () => {
  it("generates by capability and persists a sanitized rating", async () => {
    const directory = mkdtempSync(join(tmpdir(), "minimotor-level-tester-"));
    temporaryDirectories.push(directory);
    const ratingsPath = join(directory, "ratings.jsonl");
    const moduleRoot = join(directory, "modules");
    mkdirSync(join(moduleRoot, "cli", "level-tester"), { recursive: true });
    writeFileSync(join(moduleRoot, "cli", "level-tester", "client.js"), "export {};\n");
    const tester = await startStandaloneLevelTester({
      ratingsPath,
      moduleRoot,
      host: "127.0.0.1",
      port: 0,
    });
    expect(await fetch(tester.url).then((response) => response.text())).toContain(
      "/modules/cli/level-tester/client.js",
    );
    expect(
      await fetch(`${tester.url}modules/cli/level-tester/client.js`).then((response) =>
        response.text(),
      ),
    ).toBe("export {};\n");

    const client = new WebSocket(`${tester.url.replace("http:", "ws:")}ws-level-tester`);
    const seen: Record<string, unknown>[] = [];
    await new Promise<void>((resolve, reject) => {
      client.on("error", reject);
      client.on("message", (raw) => {
        const message = JSON.parse(raw.toString()) as Record<string, unknown>;
        seen.push(message);
        const candidateCount = seen.filter((row) => row.type === "candidate").length;
        if (message.type === "candidate" && candidateCount === 1) {
          client.send(
            JSON.stringify({
              type: "configure",
              config: {
                ladders: false,
                gems: false,
                dash: true,
                doubleJump: true,
                wallJump: false,
              },
            }),
          );
        } else if (message.type === "candidate" && candidateCount === 2) {
          const level = message.level as {
            features: string[];
            abilities: { dash: boolean; doubleJump: boolean; wallJump: boolean };
          };
          expect(level.features).not.toContain("ladders");
          expect(level.features).not.toContain("gems");
          expect(level.abilities.dash).toBe(true);
          expect(level.abilities.doubleJump).toBe(true);
          expect(level.abilities.wallJump).toBe(false);
          client.send(
            JSON.stringify({
              type: "rate",
              candidateId: message.candidateId,
              rating: 1,
              telemetry: { playMs: 1234, deaths: -4, jumps: 7, dashes: 2, maxX: 19 },
            }),
          );
        } else if (message.type === "rated") {
          resolve();
        }
      });
    });

    client.close();
    await tester.close();
    const row = JSON.parse(readFileSync(ratingsPath, "utf8").trim()) as {
      rating: number;
      config: { ladders: boolean; gems: boolean; dash: boolean };
      telemetry: { playMs: number; deaths: number; jumps: number };
    };
    expect(row.rating).toBe(1);
    expect(row.config).toEqual({
      ladders: false,
      gems: false,
      dash: true,
      doubleJump: true,
      wallJump: false,
    });
    expect(row.telemetry).toMatchObject({ playMs: 1234, deaths: 0, jumps: 7 });
  }, 10_000);
});
