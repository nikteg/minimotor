// Snake: classic grid-based snake with growing tail and self-collision
// Demonstrates: game loop, input, UI, storage and Goodies.wrap grid movement
import { Minimotor } from "minimotor";
import { drawGameOver } from "../../shared/src/overlays.js";

let vp = Minimotor.Stage.init("game", { plugins: [Minimotor.Perf.plugin()] });

const CELL = 20;
let COLS = Math.max(2, Math.floor(vp.w / CELL));
let ROWS = Math.max(2, Math.floor(vp.h / CELL));
const MOVE_INTERVAL = 6; // frames between moves

let snake = [{ x: Math.floor(COLS / 2), y: Math.floor(ROWS / 2) }];
let dir = { x: 1, y: 0 };
let nextDir = { x: 1, y: 0 };
let food = spawnFood();
let score = 0;
let best = Minimotor.Storage.load("snake_best", 0);
let tick = 0;
let gameOver = false;

function spawnFood() {
  let fx, fy;
  do {
    fx = Math.floor(Math.random() * COLS);
    fy = Math.floor(Math.random() * ROWS);
  } while (snake.some((s) => s.x === fx && s.y === fy));
  return { x: fx, y: fy };
}

Minimotor.Stage.onResize((next) => {
  vp = next;
  COLS = Math.max(2, Math.floor(vp.w / CELL));
  ROWS = Math.max(2, Math.floor(vp.h / CELL));
  // Segments outside the new grid wrap on their next move; food must stay
  // reachable, so respawn it if the grid shrank past it.
  if (food.x >= COLS || food.y >= ROWS) food = spawnFood();
});

function restart() {
  snake = [{ x: Math.floor(COLS / 2), y: Math.floor(ROWS / 2) }];
  dir = { x: 1, y: 0 };
  nextDir = { x: 1, y: 0 };
  food = spawnFood();
  if (score > best) { best = score; Minimotor.Storage.save("snake_best", best); }
  score = 0;
  tick = 0;
  gameOver = false;
}

// Arrow / WASD input
const keyMap = {
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
  const { Keys } = Minimotor;
  for (const code in keyMap) {
    if (!Keys.pressed(code)) continue;
    const d = keyMap[code];
    if (gameOver) restart();
    // Prevent reversing into yourself
    if (d.x === -dir.x && d.y === -dir.y) continue;
    nextDir = d;
  }
}

Minimotor.Loop.run({
  update() {
    handleInput();
    if (gameOver) return;
    tick++;
    if (tick % MOVE_INTERVAL !== 0) return;
    dir = nextDir;

    const head = {
      x: Minimotor.Goodies.wrap(snake[0].x + dir.x, COLS),
      y: Minimotor.Goodies.wrap(snake[0].y + dir.y, ROWS),
    };

    // Self collision
    if (snake.some((s) => s.x === head.x && s.y === head.y)) {
      gameOver = true;
      Minimotor.Audio.Sfx.blip(110, 0.4); // low, long — the death buzz
      Minimotor.Camera.shake(6, 320);
      Minimotor.Particles.burst(head.x * CELL + CELL / 2, head.y * CELL + CELL / 2, {
        count: 26, speed: [40, 210], size: [2, 5], life: [300, 720],
        colors: ["#8fe36a", "#4a8c2a", "#ffffff"],
      });
      if (score > best) { best = score; Minimotor.Storage.save("snake_best", best); }
      return;
    }

    snake.unshift(head);

    // Food
    if (head.x === food.x && head.y === food.y) {
      score += 10;
      Minimotor.Audio.Sfx.coin();
      Minimotor.Camera.shake(2, 90);
      Minimotor.Particles.burst(food.x * CELL + CELL / 2, food.y * CELL + CELL / 2, {
        count: 14, speed: [30, 140], size: [2, 4], life: [220, 480],
        colors: ["#ff6b6b", "#ffd36b", "#ffffff"],
      });
      food = spawnFood();
    } else {
      snake.pop();
    }
  },
  draw() {
    const { ctx } = Minimotor.Draw;
    // Backdrop.
    const bg = ctx.createLinearGradient(0, 0, 0, vp.h);
    bg.addColorStop(0, "#12141c");
    bg.addColorStop(1, "#0b0d13");
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, vp.w, vp.h);

    ctx.save();
    ctx.translate(Minimotor.Camera.shakeX(), Minimotor.Camera.shakeY());

    // Faint grid.
    ctx.strokeStyle = "rgba(255,255,255,0.04)";
    ctx.lineWidth = 1;
    for (let x = 0; x <= vp.w; x += CELL) {
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, vp.h); ctx.stroke();
    }
    for (let y = 0; y <= vp.h; y += CELL) {
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(vp.w, y); ctx.stroke();
    }

    // Food: soft glow + a pulsing berry.
    const fcx = food.x * CELL + CELL / 2, fcy = food.y * CELL + CELL / 2;
    const pulse = 1 + Math.sin(Date.now() / 200) * 0.16;
    const glow = ctx.createRadialGradient(fcx, fcy, 2, fcx, fcy, CELL * 0.9);
    glow.addColorStop(0, "rgba(255,120,120,0.5)");
    glow.addColorStop(1, "rgba(255,107,107,0)");
    ctx.fillStyle = glow;
    ctx.fillRect(fcx - CELL, fcy - CELL, CELL * 2, CELL * 2);
    ctx.fillStyle = "#ff6b6b";
    ctx.beginPath(); ctx.arc(fcx, fcy, (CELL / 2 - 3) * pulse, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "rgba(255,255,255,0.5)";
    ctx.beginPath(); ctx.arc(fcx - 2, fcy - 2, 2, 0, Math.PI * 2); ctx.fill();

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
    const hcx = h.x * CELL + CELL / 2, hcy = h.y * CELL + CELL / 2;
    const px = -dir.y, py = dir.x; // perpendicular
    for (const side of [1, -1]) {
      const ex = hcx + dir.x * 3 + px * 4 * side;
      const ey = hcy + dir.y * 3 + py * 4 * side;
      ctx.fillStyle = "#ffffff";
      ctx.beginPath(); ctx.arc(ex, ey, 2.4, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "#0c140c";
      ctx.beginPath(); ctx.arc(ex + dir.x, ey + dir.y, 1.2, 0, Math.PI * 2); ctx.fill();
    }

    Minimotor.Particles.draw(ctx);
    ctx.restore();

    // HUD.
    Minimotor.UI.group({ x: 8, y: 8, w: 280, h: 60, title: "SNAKE" }, (body) => {
      Minimotor.UI.text(`Score ${score}   Best ${best}   Len ${snake.length}`, { h: body.remaining, size: 13 });
    });

    if (gameOver) {
      drawGameOver(ctx, vp.w, vp.h, score, best, "Press any arrow key to restart");
    }
  },
});
