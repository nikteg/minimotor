import { createApp } from "../../index.js";
import { createCamera } from "../../camera/service.js";
import { createInput } from "../../input/service.js";
import { createUI } from "../../ui/service.js";
import { createPlatformerSimulation, TILE, type PlatformerSimulation } from "./simulation.js";

interface TesterConfig {
  ladders: boolean;
  gems: boolean;
  dash: boolean;
  doubleJump: boolean;
  wallJump: boolean;
}

interface Candidate {
  candidateId: string;
  seed: string;
  difficulty: number;
  score: {
    total: number;
    profile: string;
    metrics: Record<string, number>;
    components: Record<string, number>;
  };
  predictedRating: number | null;
  learnedFrom: number;
  level: {
    width: number;
    height: number;
    layout: "surface" | "tunnel" | "mixed";
    grid: string[];
    features: string[];
    abilities: { dash: boolean; doubleJump: boolean; wallJump: boolean };
  };
}

const game = createApp("game", { background: "#0b1020", resolution: { w: 960, h: 540 } });
const { Draw, Loop } = game;
const Camera = createCamera(game);
const Input = createInput(game);
const UI = createUI(game);

const input = Input.map({
  left: ["ArrowLeft", "KeyA"],
  right: ["ArrowRight", "KeyD"],
  up: ["ArrowUp", "KeyW"],
  down: ["ArrowDown", "KeyS"],
  jump: ["Space", "KeyZ"],
  dash: ["ShiftLeft", "ShiftRight", "KeyX"],
  reset: ["KeyR"],
});

let config: TesterConfig = {
  ladders: true,
  gems: true,
  dash: false,
  doubleJump: false,
  wallJump: true,
};
let candidate: Candidate | undefined;
let simulation: PlatformerSimulation | undefined;
let loading = true;
let connection = "connecting";
let ratings = 0;
let startedAt = performance.now();

function respawn(countDeath = false): void {
  simulation?.reset(countDeath);
  Camera.snap();
}

function loadCandidate(next: Candidate): void {
  candidate = next;
  simulation = createPlatformerSimulation(next.level);
  startedAt = performance.now();
  loading = false;
  Camera.follow(simulation.player, {
    world: simulation.level.rect,
    deadzone: { w: 100, h: 70 },
    damping: 0.15,
    zoom: Math.max(1, game.viewport.h / (next.level.height * TILE)),
  });
}

const protocol = location.protocol === "https:" ? "wss:" : "ws:";
const socket = new WebSocket(`${protocol}//${location.host}/ws-level-tester`);
socket.addEventListener("open", () => {
  connection = "connected";
});
socket.addEventListener("close", () => {
  connection = "disconnected — reload to retry";
  loading = true;
});
socket.addEventListener("message", (event) => {
  const message = JSON.parse(String(event.data)) as {
    type: string;
    ratings?: number;
    total?: number;
  } & Candidate;
  if (message.type === "hello") ratings = message.ratings ?? ratings;
  if (message.type === "rated") ratings = message.total ?? ratings;
  if (message.type === "candidate") loadCandidate(message);
});

function send(value: unknown): void {
  if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(value));
}

function rate(rating: 0 | 1): void {
  if (!candidate || !simulation || loading) return;
  const stats = simulation.stats;
  const telemetry = {
    playMs: Math.round(performance.now() - startedAt),
    deaths: stats.deaths,
    jumps: stats.jumps,
    dashes: stats.dashes,
    doubleJumps: stats.doubleJumps,
    wallJumps: stats.wallJumps,
    gems: stats.gems,
    maxX: Math.round(stats.maxX),
    completed: stats.completed,
    completionMs: Math.round((stats.completionSteps * 1000) / 60),
  };
  send({ type: "rate", candidateId: candidate.candidateId, rating, telemetry });
  loading = true;
}

function skip(): void {
  if (loading) return;
  send({ type: "next" });
  loading = true;
}

function reconfigure(next: TesterConfig): void {
  if (
    next.ladders === config.ladders &&
    next.gems === config.gems &&
    next.dash === config.dash &&
    next.doubleJump === config.doubleJump &&
    next.wallJump === config.wallJump
  )
    return;
  config = next;
  send({ type: "configure", config });
  loading = true;
}

function update(): void {
  if (!simulation || !candidate || loading) return;
  if (input.reset.pressed) respawn();
  simulation.step({
    left: input.left.down,
    right: input.right.down,
    up: input.up.down,
    down: input.down.down,
    jumpPressed: input.jump.pressed,
    jumpReleased: input.jump.released,
    dashPressed: input.dash.pressed,
  });
}

function drawLevel(): void {
  if (!simulation || !candidate) return;
  const { level, player, gems, exit, stats } = simulation;
  Draw.rect(0, 0, level.rect.w, level.rect.h, "#111a2e");
  for (let y = 0; y < candidate.level.height; y++) {
    for (let x = 0; x < candidate.level.width; x++) {
      const glyph = candidate.level.grid[y][x];
      const px = x * TILE;
      const py = y * TILE;
      if (glyph === "#") {
        Draw.rect(px, py, TILE, TILE, "#334155");
        if (candidate.level.grid[y - 1]?.[x] !== "#") Draw.rect(px, py, TILE, 3, "#64748b");
      } else if (glyph === "=") {
        Draw.rect(px, py + 3, TILE, 4, "#f59e0b");
      } else if (glyph === "H") {
        Draw.line(px + 4, py, px + 4, py + TILE, "#a78bfa", 2);
        Draw.line(px + 12, py, px + 12, py + TILE, "#a78bfa", 2);
        Draw.line(px + 4, py + 5, px + 12, py + 5, "#a78bfa", 2);
        Draw.line(px + 4, py + 12, px + 12, py + 12, "#a78bfa", 2);
      }
    }
  }
  Draw.circle(exit.x, exit.y, 7, stats.completed ? "#5eead4" : "#22d3ee");
  Draw.circle(exit.x, exit.y, 3, "#0f172a");
  for (const gem of gems) {
    if (!gem.taken) Draw.circle(gem.x, gem.y, 5, "#facc15");
  }
  Draw.rect(player, simulation.dashing ? "#f472b6" : "#fb7185");
  Draw.rect(player.x + (player.facing > 0 ? 8 : 2), player.y + 5, 2, 3, "#111827");
}

function percent(value: number | null): string {
  return value === null ? "learning after 3 ratings" : `${Math.round(value * 100)}%`;
}

function drawHud(): void {
  const view = game.viewport;
  UI.panel({ x: 12, y: 12, w: 285, title: "LEVEL TESTER", gap: 7 }, () => {
    UI.text(connection, { size: 11, color: connection === "connected" ? "accent" : "dim" });
    if (!candidate) {
      UI.text("Waiting for a generated level…", { size: 12 });
      return;
    }
    UI.text(`${candidate.level.layout} · seed ${candidate.seed.slice(-26)}`, {
      size: 10,
      color: "dim",
    });
    UI.text(
      `heuristic ${Math.round(candidate.score.total * 100)}%  ·  predicted ${percent(candidate.predictedRating)}`,
      { size: 11, bold: true },
    );
    UI.text(`trained on ${candidate.learnedFrom} matching ratings · ${ratings} total`, {
      size: 10,
      color: "dim",
    });
    UI.row({ gap: 5 }, () => {
      if (UI.button({ id: "like", label: "👍 LIKE", w: 82, h: 27 })) rate(1);
      if (UI.button({ id: "dislike", label: "👎 DISLIKE", w: 92, h: 27, variant: "danger" }))
        rate(0);
      if (UI.button({ id: "skip", label: "SKIP", w: 61, h: 27 })) skip();
    });
    const stats = simulation?.stats;
    UI.text(
      `${stats?.completed ? "exit reached" : "find the cyan exit"} · deaths ${stats?.deaths ?? 0} · gems ${stats?.gems ?? 0}/${simulation?.gems.length ?? 0}`,
      { size: 10, color: stats?.completed ? "accent" : "dim" },
    );
  });

  UI.panel({ x: view.w - 235, y: 12, w: 223, title: "GENERATOR RULES", gap: 6 }, () => {
    const ladders = UI.toggle({
      id: "ladders",
      label: "Allow ladders",
      on: config.ladders,
    });
    const gemsEnabled = UI.toggle({ id: "gems", label: "Place gems", on: config.gems });
    const dash = UI.toggle({ id: "dash", label: "Dash ability", on: config.dash });
    const doubleJump = UI.toggle({
      id: "double-jump",
      label: "Double jump",
      on: config.doubleJump,
    });
    const wallJump = UI.toggle({
      id: "wall-jump",
      label: "Wall jump",
      on: config.wallJump,
    });
    reconfigure({ ladders, gems: gemsEnabled, dash, doubleJump, wallJump });
    UI.text("Each ruleset learns independently.", { size: 10, color: "dim" });
  });

  UI.text(`A/D or ←/→ move · Space/Z jump · ${config.dash ? "Shift/X dash · " : ""}R restart`, {
    x: 12,
    y: view.h - 24,
    size: 11,
    color: "dim",
  });
  if (loading)
    UI.text("GENERATING…", {
      x: view.w / 2,
      y: view.h / 2,
      size: 22,
      bold: true,
      align: "center",
      color: "accent",
    });
}

Loop.run({
  update,
  draw() {
    if (simulation) {
      Camera.zoom = Math.max(1, game.viewport.h / ((candidate?.level.height ?? 22) * TILE));
      Camera.render(drawLevel);
    }
    drawHud();
  },
});
