import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";
import { WebSocket, WebSocketServer } from "ws";
import {
  optimizeLevels,
  trainPreferenceModel,
  type GeneratedFeature,
  type LevelScore,
  type PreferenceModel,
} from "../features/level.feature.js";

export interface TesterConfig {
  ladders: boolean;
  gems: boolean;
  dash: boolean;
  doubleJump: boolean;
  wallJump: boolean;
}

interface RatingRow {
  candidateId: string;
  seed: string;
  rating: number;
  metrics: LevelScore["metrics"];
  heuristicScore: number;
  config: TesterConfig;
  telemetry: {
    playMs: number;
    deaths: number;
    jumps: number;
    dashes: number;
    doubleJumps: number;
    wallJumps: number;
    gems: number;
    maxX: number;
    completed: boolean;
    completionMs: number;
  };
  createdAt: string;
}

const parseRows = (path: string): RatingRow[] => {
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf8")
    .split(/\r?\n/)
    .filter(Boolean)
    .flatMap((line) => {
      try {
        const row = JSON.parse(line) as RatingRow;
        row.config = {
          ...row.config,
          doubleJump: row.config.doubleJump === true,
          // Ratings made before this switch existed used wall jumps.
          wallJump: row.config.wallJump !== false,
        };
        return [row];
      } catch {
        return [];
      }
    });
};

const sameConfig = (a: TesterConfig, b: TesterConfig) =>
  a.ladders === b.ladders &&
  a.gems === b.gems &&
  a.dash === b.dash &&
  a.doubleJump === b.doubleJump &&
  a.wallJump === b.wallJump;

const finiteNumber = (value: unknown, max: number) =>
  typeof value === "number" && Number.isFinite(value)
    ? Math.max(0, Math.min(max, Math.round(value)))
    : 0;

function sanitizeTelemetry(value: unknown): RatingRow["telemetry"] {
  const data =
    typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {};
  return {
    playMs: finiteNumber(data.playMs, 60 * 60 * 1000),
    deaths: finiteNumber(data.deaths, 10_000),
    jumps: finiteNumber(data.jumps, 100_000),
    dashes: finiteNumber(data.dashes, 100_000),
    doubleJumps: finiteNumber(data.doubleJumps, 100_000),
    wallJumps: finiteNumber(data.wallJumps, 100_000),
    gems: finiteNumber(data.gems, 10_000),
    maxX: finiteNumber(data.maxX, 100_000),
    completed: data.completed === true,
    completionMs: finiteNumber(data.completionMs, 60 * 60 * 1000),
  };
}

export function createLevelTesterServer(ratingsPath: string): WebSocketServer {
  mkdirSync(dirname(ratingsPath), { recursive: true });
  const ratings = parseRows(ratingsPath);
  const wss = new WebSocketServer({ noServer: true });

  wss.on("connection", (socket) => {
    const session = randomUUID();
    let round = 0;
    let config: TesterConfig = {
      ladders: true,
      gems: true,
      dash: false,
      doubleJump: false,
      wallJump: true,
    };
    let current:
      | {
          id: string;
          seed: string;
          score: LevelScore;
        }
      | undefined;

    const send = (value: unknown) => {
      if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(value));
    };

    const modelForConfig = (): PreferenceModel | undefined => {
      const relevant = ratings.filter((row) => sameConfig(row.config, config));
      if (relevant.length < 3) return undefined;
      return trainPreferenceModel(
        relevant.map((row) => ({ metrics: row.metrics, rating: row.rating })),
      );
    };

    const next = () => {
      const features: GeneratedFeature[] = ["gaps", "platforms", "tunnels", "exit"];
      if (config.ladders) features.push("ladders");
      if (config.gems) features.push("gems");
      const model = modelForConfig();
      const result = optimizeLevels({
        seed: `${session}:${round++}`,
        count: 80,
        width: 48,
        height: 22,
        profile: "balanced",
        features,
        abilities: {
          dash: config.dash,
          doubleJump: config.doubleJump,
          wallJump: config.wallJump,
        },
        model,
      });
      const candidate = result.elites[round % result.elites.length] ?? result.best;
      current = { id: randomUUID(), seed: candidate.seed, score: candidate.score };
      send({
        type: "candidate",
        candidateId: current.id,
        seed: candidate.seed,
        difficulty: candidate.difficulty,
        score: candidate.score,
        predictedRating: model ? candidate.fitness : null,
        learnedFrom: ratings.filter((row) => sameConfig(row.config, config)).length,
        level: {
          width: candidate.level.width,
          height: candidate.level.height,
          layout: candidate.level.layout,
          grid: candidate.level.grid,
          features: candidate.level.features,
          abilities: candidate.level.abilities,
        },
      });
    };

    socket.on("message", (data) => {
      let message: Record<string, unknown>;
      try {
        message = JSON.parse(data.toString()) as Record<string, unknown>;
      } catch {
        return send({ type: "error", message: "invalid JSON" });
      }
      if (message.type === "configure") {
        const value =
          typeof message.config === "object" && message.config !== null
            ? (message.config as Partial<TesterConfig>)
            : undefined;
        config = {
          ladders: value?.ladders !== false,
          gems: value?.gems !== false,
          dash: value?.dash === true,
          doubleJump: value?.doubleJump === true,
          wallJump: value?.wallJump !== false,
        };
        current = undefined;
        next();
      } else if (message.type === "rate" && current && message.candidateId === current.id) {
        const row: RatingRow = {
          candidateId: current.id,
          seed: current.seed,
          rating: message.rating === 1 ? 1 : 0,
          metrics: current.score.metrics,
          heuristicScore: current.score.total,
          config,
          telemetry: sanitizeTelemetry(message.telemetry),
          createdAt: new Date().toISOString(),
        };
        ratings.push(row);
        appendFileSync(ratingsPath, `${JSON.stringify(row)}\n`);
        send({
          type: "rated",
          likes: ratings.filter((rating) => rating.rating === 1).length,
          dislikes: ratings.filter((rating) => rating.rating === 0).length,
          total: ratings.length,
        });
        current = undefined;
        next();
      } else if (message.type === "next") {
        current = undefined;
        next();
      }
    });

    send({ type: "hello", ratings: ratings.length });
    next();
  });
  return wss;
}
