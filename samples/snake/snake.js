// Snake: classic grid-based snake with growing tail and self-collision
// Demonstrates: game loop, input, UI, storage and Goodies.wrap grid movement
import { Minimotor } from "minimotor";
import { drawGameOver } from "../shared/overlays.js";

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
      if (score > best) { best = score; Minimotor.Storage.save("snake_best", best); }
      return;
    }

    snake.unshift(head);

    // Food
    if (head.x === food.x && head.y === food.y) {
      score += 10;
      Minimotor.Audio.Sfx.coin();
      food = spawnFood();
    } else {
      snake.pop();
    }
  },
  draw() {
    const { ctx } = Minimotor.Draw;
    ctx.clearRect(0, 0, vp.w, vp.h);

    // Grid background
    ctx.fillStyle = "#1a1a1a";
    ctx.fillRect(0, 0, vp.w, vp.h);
    ctx.strokeStyle = "#222";
    ctx.lineWidth = 0.5;
    for (let x = 0; x <= vp.w; x += CELL) {
      ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, vp.h); ctx.stroke();
    }
    for (let y = 0; y <= vp.h; y += CELL) {
      ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(vp.w, y); ctx.stroke();
    }

    // Snake
    snake.forEach((s, i) => {
      const t = 1 - i / (snake.length + 10);
      ctx.fillStyle = `hsl(${140 + t * 30}, 70%, ${30 + t * 30}%)`;
      ctx.fillRect(s.x * CELL + 1, s.y * CELL + 1, CELL - 2, CELL - 2);
    });

    // Food (pulsing)
    const pulse = 1 + Math.sin(Date.now() / 200) * 0.2;
    ctx.fillStyle = "#ff6b6b";
    ctx.beginPath();
    ctx.arc(
      food.x * CELL + CELL / 2,
      food.y * CELL + CELL / 2,
      (CELL / 2 - 2) * pulse,
      0, Math.PI * 2,
    );
    ctx.fill();

    // HUD
    Minimotor.UI.text(`Score: ${score}  Best: ${best}  Length: ${snake.length}`, { x: 10, y: 4, size: 14 });

    if (gameOver) {
      drawGameOver(ctx, vp.w, vp.h, score, best, "Press any arrow key to restart");
    }
  },
});
