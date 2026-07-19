// Snake: classic grid-based snake with growing tail and self-collision
// Demonstrates: game loop, input, scoring, storage, grid collision
import { Minimotor } from "../../build/index.js";

const vp = Minimotor.Engine.initCanvas("game");

const CELL = 20;
const COLS = Math.floor(vp.w / CELL);
const ROWS = Math.floor(vp.h / CELL);
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
Minimotor.Engine.onKeyDown = (code) => {
  const d = keyMap[code];
  if (!d) return;
  // Prevent reversing into yourself
  if (d.x === -dir.x && d.y === -dir.y) return;
  nextDir = d;
  if (gameOver) restart();
};

Minimotor.Perf.withHud(Minimotor.Engine)(
  () => {
    if (gameOver) return;
    tick++;
    if (tick % MOVE_INTERVAL !== 0) return;
    dir = nextDir;

    const head = { x: snake[0].x + dir.x, y: snake[0].y + dir.y };

    // Wall collision (wraps for a twist)
    if (head.x < 0) head.x = COLS - 1;
    if (head.x >= COLS) head.x = 0;
    if (head.y < 0) head.y = ROWS - 1;
    if (head.y >= ROWS) head.y = 0;

    // Self collision
    if (snake.some((s) => s.x === head.x && s.y === head.y)) {
      gameOver = true;
      if (score > best) { best = score; Minimotor.Storage.save("snake_best", best); }
      return;
    }

    snake.unshift(head);

    // Food
    if (head.x === food.x && head.y === food.y) {
      score += 10;
      food = spawnFood();
    } else {
      snake.pop();
    }
  },
  () => {
    const ctx = Minimotor.Engine.ctx;
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
    ctx.fillStyle = "#fff";
    ctx.font = "14px monospace";
    ctx.fillText(`Score: ${score}  Best: ${best}  Length: ${snake.length}`, 10, 18);

    if (gameOver) {
      ctx.fillStyle = "rgba(0,0,0,0.6)";
      ctx.fillRect(0, 0, vp.w, vp.h);
      ctx.fillStyle = "#ff6b6b";
      ctx.font = "28px monospace";
      ctx.textAlign = "center";
      ctx.fillText("GAME OVER", vp.w / 2, vp.h / 2 - 12);
      ctx.fillStyle = "#fff";
      ctx.font = "16px monospace";
      ctx.fillText(`Score: ${score}  Best: ${best}`, vp.w / 2, vp.h / 2 + 20);
      ctx.fillText("Press any arrow key to restart", vp.w / 2, vp.h / 2 + 46);
      ctx.textAlign = "start";
    }
  },
);
