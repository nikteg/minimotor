// ASSET QUEST: a tiny playable archive loaded from a manifest at runtime.
// Focus: Assets.load/progress/json and Anim.sheet, with plain JSON level data.
import { Anim, Assets, Collision, Draw, Keys, Loop, Particles, Perf, Stage, UI } from "minimotor";
import type { SheetCursor } from "minimotor";
import * as Sfx from "../shared/sfx.ts";

interface Level {
  name?: string;
  tiles: number[][];
  message: string;
}
interface Relic {
  x: number;
  y: number;
  got: boolean;
}

// The viewport is LIVE (mutated on resize); the engine clears to `background`.
const vp = Stage.init("game", {
  background: "#111827",
  plugins: [Perf.plugin()],
  preventNavigation: true,
});
let progress = 0;
let ready = false;
let failed = ""; // non-empty once the manifest load rejects → show a failed screen
let level: Level;
let hero: SheetCursor<"walk">;
let relics: Relic[] = [];
let score = 0;
let state: "play" | "won" = "play";
let elapsed = 0;
const TILE = 48; // world tile size in px — the grid coordinate unit
const BODY_R = 15; // the hero's collision radius, shared by wall probing and pickups
const player = { x: 96, y: 128, speed: 2.4 }; // px/step
const gate = { x: 12 * TILE + TILE / 2, y: TILE + TILE / 2 };
const fx = Particles.create();

// Build a deliberately clean 8-frame astronaut sheet procedurally (slicing
// arbitrary artwork was the source of the old "spinning icon" bug).
function makeHeroSheet(): HTMLCanvasElement {
  const sheet = document.createElement("canvas");
  sheet.width = 48 * 8;
  sheet.height = 48;
  const c = sheet.getContext("2d")!;
  for (let i = 0; i < 8; i++) {
    const x = i * 48 + 24;
    const step = Math.sin((i / 8) * Math.PI * 2) * 3;
    c.save();
    c.translate(x, 24);
    c.fillStyle = "#172b4d";
    c.beginPath();
    c.ellipse(0, 7, 11, 13, 0, 0, Math.PI * 2);
    c.fill();
    c.strokeStyle = "#64f0c8";
    c.lineWidth = 2;
    c.stroke();
    c.fillStyle = "#b8fff0";
    c.beginPath();
    c.arc(0, -7, 9, 0, Math.PI * 2);
    c.fill();
    c.fillStyle = "#234b69";
    c.fillRect(-6, -9, 12, 5);
    c.fillStyle = "#ff9f43";
    c.fillRect(-8, 18 + step, 6, 4);
    c.fillRect(2, 18 - step, 6, 4);
    c.strokeStyle = "#ffe066";
    c.beginPath();
    c.moveTo(0, -16);
    c.lineTo(0, -21);
    c.stroke();
    c.fillStyle = "#ffe066";
    c.beginPath();
    c.arc(0, -22, 2, 0, Math.PI * 2);
    c.fill();
    c.restore();
  }
  return sheet;
}

// JSON is loaded from the manifest; the loading screen itself uses no DOM UI.
Assets.load({ level: new URL("./level.json", import.meta.url).href }, (done, total) => {
  progress = done / total;
})
  .then(() => {
    level = Assets.json<Level>("level");
    // A named-state sheet; the cursor derives its frame from the clock.
    hero = Anim.sheet(makeHeroSheet(), {
      frame: { w: 48, h: 48 },
      states: { walk: { row: 0, frames: 8, fps: 10 } },
    }).play("walk");
    relics = level.tiles.flatMap((row, y) =>
      row
        .map((tile, x): Relic | null =>
          tile === 2 ? { x: x * TILE + TILE / 2, y: y * TILE + TILE / 2, got: false } : null,
        )
        .filter((r): r is Relic => r !== null),
    );
    resetGame();
    ready = true;
  })
  .catch((err) => {
    // Flip a failed flag so draw() leaves the LOADING screen and reports the
    // error, instead of spinning on the progress bar forever.
    failed = String(err);
  });

function solid(x: number, y: number): boolean {
  const tx = Math.floor(x / TILE),
    ty = Math.floor(y / TILE);
  const tile = level?.tiles?.[ty]?.[tx];
  return tile == null || tile === 1;
}
function circleClear(x: number, y: number, radius = BODY_R): boolean {
  const points = [
    [-radius, 0],
    [radius, 0],
    [0, -radius],
    [0, radius],
    [-radius * 0.7, -radius * 0.7],
    [radius * 0.7, -radius * 0.7],
    [-radius * 0.7, radius * 0.7],
    [radius * 0.7, radius * 0.7],
  ];
  return points.every(([px, py]) => !solid(x + px, y + py));
}
function move(dx: number, dy: number) {
  const nx = player.x + dx,
    ny = player.y + dy;
  // Resolve axes independently: walls block cleanly while allowing sliding.
  if (circleClear(nx, player.y)) player.x = nx;
  if (circleClear(player.x, ny)) player.y = ny;
}
function resetGame() {
  player.x = 96;
  player.y = 128;
  score = 0;
  elapsed = 0;
  state = "play";
  for (const relic of relics) relic.got = false;
}

Loop.run({
  update() {
    if (!ready) return;
    if (Keys.pressed("KeyR")) resetGame();
    if (state !== "play") return;
    elapsed += Loop.step / 1000;
    if (Keys.down("ArrowLeft") || Keys.down("KeyA")) move(-player.speed, 0);
    if (Keys.down("ArrowRight") || Keys.down("KeyD")) move(player.speed, 0);
    if (Keys.down("ArrowUp") || Keys.down("KeyW")) move(0, -player.speed);
    if (Keys.down("ArrowDown") || Keys.down("KeyS")) move(0, player.speed);
    for (const r of relics)
      if (!r.got && Collision.circleHit(player.x, player.y, BODY_R, r.x, r.y, 9)) {
        r.got = true;
        score++;
        Sfx.pickup();
        UI.floatText("+1 KEY", r.x, r.y - 22, { color: "#ffe066" });
        fx.burst({
          at: r,
          count: 18,
          color: ["#ffe066", "#fff"],
          speed: [0.5, 2.5],
          life: [300, 650],
          gravity: 0.022,
        });
      }
    if (
      score === relics.length &&
      Collision.circleHit(player.x, player.y, BODY_R, gate.x, gate.y, 13)
    ) {
      state = "won";
      Sfx.win();
      fx.burst({
        at: gate,
        count: 45,
        color: ["#64f0c8", "#ffe066", "#fff"],
        speed: [0.7, 3.7],
        life: [500, 1200],
        gravity: 0.017,
      });
    }
  },
  draw() {
    if (!ready) {
      Draw.text(failed ? "ARCHIVE FAILED TO LOAD" : "LOADING MOONLIT ARCHIVE", {
        x: vp.w / 2,
        y: vp.h / 2 - 24,
        font: "bold 24px monospace",
        color: failed ? "#ff6b6b" : "#ffe066",
        align: "center",
      });
      if (failed) {
        Draw.text(failed, {
          x: vp.w / 2,
          y: vp.h / 2 + 12,
          size: 13,
          color: "#9fb3d9",
          align: "center",
        });
        return;
      }
      UI.panel({
        x: vp.w / 2 - 170,
        y: vp.h / 2 + 4,
        w: 340,
        h: 34,
        bg: "#172640",
        border: "#38557e",
      });
      UI.bar(vp.w / 2 - 150, vp.h / 2 + 15, 300, 12, progress, { fill: "#4ecdc4", bg: "#263653" });
      return;
    }
    const ox = Math.max(12, (vp.w - 14 * TILE) / 2),
      oy = Math.max(60, (vp.h - 7 * TILE) / 2);
    for (let y = 0; y < level.tiles.length; y++)
      for (let x = 0; x < level.tiles[y].length; x++) {
        const tile = level.tiles[y][x];
        Draw.rect(ox + x * TILE, oy + y * TILE, 47, 47, tile === 1 ? "#263653" : "#16233b");
        if (tile === 1) Draw.rect(ox + x * TILE + 5, oy + y * TILE + 5, 37, 5, "#354b72");
      }
    // World is intentionally translated so the JSON map is centered responsively
    // (a static layout offset, not a camera) — the raw-ctx escape hatch.
    const { ctx } = Draw;
    ctx.save();
    ctx.translate(ox, oy);
    const gateOpen = score === relics.length;
    Draw.rect(gate.x - 15, gate.y - 20, 30, 40, gateOpen ? "#64f0c8" : "#405477");
    Draw.rect(gate.x - 9, gate.y - 14, 18, 28, gateOpen ? "#d9fff6" : "#182942");
    for (const r of relics)
      if (!r.got) {
        const pulse = 10 + Math.sin(performance.now() / 180 + r.x) * 2;
        Draw.circle(r.x, r.y, pulse, "#ffe066");
        Draw.circle(r.x - 3, r.y - 3, 3, "#fff8");
      }
    Draw.sprite(hero, { x: player.x - 23, y: player.y - 23, w: 46, h: 46 });
    // Pickup/gate bursts live in world coordinates, so render them under the
    // same map offset as the player instead of at raw screen coordinates.
    UI.drawFloatText();
    Draw.particles(fx);
    ctx.restore();
    UI.panel({ x: 8, y: 7, w: 350, h: 38, bg: "rgba(8,14,27,.85)", border: "#38557e" });
    Draw.text(`MOON KEYS ${score}/${relics.length}   TIME ${elapsed.toFixed(1)}s`, {
      x: 14,
      y: 14,
      font: "bold 16px monospace",
      color: "#fff",
    });
    Draw.text("WASD / ARROWS: MOVE · R: RESTART", {
      x: 14,
      y: 36,
      size: 12,
      color: "#9fb3d9",
    });
    Draw.text(gateOpen ? "All keys found — reach the glowing archive gate" : level.message, {
      x: 14,
      y: vp.h - 26,
      size: 13,
      color: gateOpen ? "#64f0c8" : "#9fb3d9",
    });
    if (state === "won") {
      Draw.rect(0, 0, vp.w, vp.h, "rgba(8,14,27,.82)");
      Draw.text("ARCHIVE RESTORED", {
        x: vp.w / 2,
        y: vp.h / 2 - 24,
        font: "bold 30px monospace",
        color: "#64f0c8",
        align: "center",
      });
      Draw.text(`Run time ${elapsed.toFixed(1)}s`, {
        x: vp.w / 2,
        y: vp.h / 2 + 10,
        size: 16,
        color: "#fff",
        align: "center",
      });
      Draw.text("Press R to explore again", {
        x: vp.w / 2,
        y: vp.h / 2 + 42,
        size: 13,
        color: "#9fb3d9",
        align: "center",
      });
    }
  },
});
