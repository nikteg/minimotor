import { createDebug } from "minimotor/debug";
// Snake: classic grid-based snake with growing tail and self-collision
// Demonstrates: game loop, input, UI, storage and Goodies.wrap grid movement
import { createAudio } from "minimotor/audio";
import { createCamera } from "minimotor/camera";
import { createParticles } from "minimotor/particles";
import { createUI } from "minimotor/ui";
import { Gizmos, Goodies, createApp } from "minimotor";
import { createOverlays } from "../shared/overlays.ts";

// The viewport is LIVE (mutated on resize) — grid sizing reacts in onResize.
const game = createApp("game", { preventNavigation: true });
createDebug(game, { initial: "performance" });
const view = game.viewport;
const { Draw, Keys, Loop } = game;
const { drawGameOver } = createOverlays(Draw);
const Audio = createAudio(game);
const Camera = createCamera(game);
const Particles = createParticles(game);
const UI = createUI(game);

const CELL = 20;
let COLS = Math.max(2, Math.floor(view.w / CELL));
let ROWS = Math.max(2, Math.floor(view.h / CELL));
const MOVE_INTERVAL = 6; // frames between moves

let snake = [{ x: Math.floor(COLS / 2), y: Math.floor(ROWS / 2) }];
let dir = { x: 1, y: 0 };
let nextDir = { x: 1, y: 0 };
let food = spawnFood();
const scores = Gizmos.scoreTracker("snake_best");
const fx = Particles.createSystem();
let tick = 0;
let gameOver = false;

// A uniformly-random empty cell (bounded scan — returns null only when the
// board is full, i.e. you've won). Beats the old `do { rand } while (taken)`.
function spawnFood() {
  const occupied = (x: number, y: number) => snake.some((s) => s.x === x && s.y === y);
  return Goodies.randFreeCell(COLS, ROWS, occupied) ?? snake[0];
}

game.onResize(() => {
  COLS = Math.max(2, Math.floor(view.w / CELL));
  ROWS = Math.max(2, Math.floor(view.h / CELL));
  // Segments outside the new grid wrap on their next move; food must stay
  // reachable, so respawn it if the grid shrank past it.
  if (food.x >= COLS || food.y >= ROWS) food = spawnFood();
});

function restart() {
  snake = [{ x: Math.floor(COLS / 2), y: Math.floor(ROWS / 2) }];
  dir = { x: 1, y: 0 };
  nextDir = { x: 1, y: 0 };
  food = spawnFood();
  scores.reset();
  tick = 0;
  gameOver = false;
}

// Arrow / WASD input
const keyMap: Record<string, { x: number; y: number }> = {
  ArrowUp: { x: 0, y: -1 },
  ArrowDown: { x: 0, y: 1 },
  ArrowLeft: { x: -1, y: 0 },
  ArrowRight: { x: 1, y: 0 },
  KeyW: { x: 0, y: -1 },
  KeyS: { x: 0, y: 1 },
  KeyA: { x: -1, y: 0 },
  KeyD: { x: 1, y: 0 },
};
function handleInput() {
  for (const code in keyMap) {
    if (!Keys.pressed(code)) continue;
    const d = keyMap[code];
    if (gameOver) restart();
    // Prevent reversing into yourself
    if (d.x === -dir.x && d.y === -dir.y) continue;
    nextDir = d;
  }
}

Loop.run({
  update() {
    handleInput();
    if (gameOver) return;
    tick++;
    if (tick % MOVE_INTERVAL !== 0) return;
    dir = nextDir;

    const head = {
      x: Goodies.wrap(snake[0].x + dir.x, COLS),
      y: Goodies.wrap(snake[0].y + dir.y, ROWS),
    };

    // Self collision
    if (snake.some((s) => s.x === head.x && s.y === head.y)) {
      gameOver = true;
      scores.save();
      Audio.Sfx.blip(110, 0.4); // low, long — the death buzz
      Camera.shake(6, 320);
      fx.burst({
        at: { x: head.x * CELL + CELL / 2, y: head.y * CELL + CELL / 2 },
        count: 26,
        speed: [0.7, 3.5],
        size: [2, 5],
        life: [300, 720],
        color: ["#8fe36a", "#4a8c2a", "#ffffff"],
      });
      return;
    }

    snake.unshift(head);

    // Food
    if (head.x === food.x && head.y === food.y) {
      scores.add(10);
      Audio.Sfx.coin();
      Camera.shake(2, 90);
      fx.burst({
        at: { x: food.x * CELL + CELL / 2, y: food.y * CELL + CELL / 2 },
        count: 14,
        speed: [0.5, 2.3],
        size: [2, 4],
        life: [220, 480],
        color: ["#ff6b6b", "#ffd36b", "#ffffff"],
      });
      food = spawnFood();
    } else {
      snake.pop();
    }
  },
  draw() {
    const { ctx } = Draw;
    // Backdrop.
    const bg = ctx.createLinearGradient(0, 0, 0, view.h);
    bg.addColorStop(0, "#12141c");
    bg.addColorStop(1, "#0b0d13");
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, view.w, view.h);

    // The primary camera is identity — this block just applies the shake.
    Camera.render(() => {
      // Faint grid.
      ctx.strokeStyle = "rgba(255,255,255,0.04)";
      ctx.lineWidth = 1;
      for (let x = 0; x <= view.w; x += CELL) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, view.h);
        ctx.stroke();
      }
      for (let y = 0; y <= view.h; y += CELL) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(view.w, y);
        ctx.stroke();
      }

      // Food: soft glow + a pulsing berry.
      const fcx = food.x * CELL + CELL / 2,
        fcy = food.y * CELL + CELL / 2;
      const pulse = 1 + Math.sin(performance.now() / 200) * 0.16;
      const glow = ctx.createRadialGradient(fcx, fcy, 2, fcx, fcy, CELL * 0.9);
      glow.addColorStop(0, "rgba(255,120,120,0.5)");
      glow.addColorStop(1, "rgba(255,107,107,0)");
      ctx.fillStyle = glow;
      ctx.fillRect(fcx - CELL, fcy - CELL, CELL * 2, CELL * 2);
      ctx.fillStyle = "#ff6b6b";
      ctx.beginPath();
      ctx.arc(fcx, fcy, (CELL / 2 - 3) * pulse, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "rgba(255,255,255,0.5)";
      ctx.beginPath();
      ctx.arc(fcx - 2, fcy - 2, 2, 0, Math.PI * 2);
      ctx.fill();

      // Snake: rounded segments, brighter toward the head.
      snake.forEach((s, i) => {
        const t = 1 - i / (snake.length + 8);
        ctx.fillStyle = `hsl(${135 + t * 35}, 65%, ${34 + t * 26}%)`;
        ctx.beginPath();
        ctx.roundRect(s.x * CELL + 1.5, s.y * CELL + 1.5, CELL - 3, CELL - 3, 5);
        ctx.fill();
      });

      // Head eyes, looking along the direction of travel.
      const h = snake[0];
      const hcx = h.x * CELL + CELL / 2,
        hcy = h.y * CELL + CELL / 2;
      const px = -dir.y,
        py = dir.x; // perpendicular
      for (const side of [1, -1]) {
        const ex = hcx + dir.x * 3 + px * 4 * side;
        const ey = hcy + dir.y * 3 + py * 4 * side;
        ctx.fillStyle = "#ffffff";
        ctx.beginPath();
        ctx.arc(ex, ey, 2.4, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = "#0c140c";
        ctx.beginPath();
        ctx.arc(ex + dir.x, ey + dir.y, 1.2, 0, Math.PI * 2);
        ctx.fill();
      }

      Draw.particles(fx);
    });

    // HUD.
    UI.panel({ x: 8, y: 8, w: 280, h: 60, title: "SNAKE" }, (body) => {
      UI.text(`Score ${scores.score}   Best ${scores.best}   Len ${snake.length}`, {
        h: body.remaining,
        size: 13,
      });
    });

    if (gameOver) {
      drawGameOver(view.w, view.h, scores.score, scores.best, "Press any arrow key to restart");
    }
  },
});
