// Breakout: paddle + ball + rows of destructible blocks
// Game runs in a fixed 400×700 logical space, scaled to fit the viewport.
// Demonstrates: game loop, collision, input, scoring, storage, lives, Perf HUD
import { Minimotor } from "../../build/index.js";

Minimotor.Engine.use(Minimotor.Perf.plugin());

const vp = Minimotor.Engine.initCanvas("game");

// Fixed game dimensions — scaled to fit viewport, maintaining aspect ratio
const GW = 400;
const GH = 700;
const scale = Math.min(vp.w / GW, vp.h / GH);
const ox = (vp.w - GW * scale) / 2; // letterbox offset X
const oy = (vp.h - GH * scale) / 2; // letterbox offset Y

const PADDLE_W = 80;
const PADDLE_H = 14;
const BALL_R = 6;

// Block grid
const ROWS = 5;
const COLS = 8;
const BLOCK_W = 42;
const BLOCK_H = 18;
const BLOCK_GAP = 3;
const BLOCK_TOP = 80;
const gridW = COLS * (BLOCK_W + BLOCK_GAP) - BLOCK_GAP;

// Rainbow colors per row
const ROW_COLORS = ["#ff6b6b", "#ffa94d", "#ffd43b", "#69db7c", "#4ecdc4"];

let paddle = { x: GW / 2 - PADDLE_W / 2, y: GH - 60, w: PADDLE_W, h: PADDLE_H };
let ball = { x: GW / 2, y: GH - 80, r: BALL_R, vx: 2.5, vy: -2.5 };

let blocks = [];
let score = 0;
let lives = 3;
let best = Minimotor.Storage.load("breakout_best", 0);
let gameOver = false;
let waiting = false;

const keys = {};
Minimotor.Engine.onKeyDown = (code) => { keys[code] = true; };
window.addEventListener("keyup", (e) => { keys[e.code] = false; });

function spawnBlocks() {
  blocks = [];
  for (let row = 0; row < ROWS; row++) {
    for (let col = 0; col < COLS; col++) {
      blocks.push({
        x: (GW - gridW) / 2 + col * (BLOCK_W + BLOCK_GAP),
        y: BLOCK_TOP + row * (BLOCK_H + BLOCK_GAP),
        w: BLOCK_W,
        h: BLOCK_H,
        color: ROW_COLORS[row],
        alive: true,
      });
    }
  }
}

function resetBall() {
  ball.x = paddle.x + paddle.w / 2;
  ball.y = paddle.y - BALL_R - 1;
  ball.vx = (Math.random() > 0.5 ? 1 : -1) * 2.5;
  ball.vy = -2.5;
  waiting = true;
}

spawnBlocks();

Minimotor.Engine.start(
  () => {
    if (gameOver) return;

    // Paddle
    const speed = 6;
    if (keys["ArrowLeft"]) paddle.x = Math.max(0, paddle.x - speed);
    if (keys["ArrowRight"]) paddle.x = Math.min(GW - PADDLE_W, paddle.x + speed);

    if (waiting) {
      ball.x = paddle.x + paddle.w / 2;
      if (keys["Space"] || keys["ArrowUp"]) waiting = false;
      return;
    }

    // Ball movement
    ball.x += ball.vx;
    ball.y += ball.vy;

    // Wall bounce
    if (ball.x - BALL_R <= 0) { ball.x = BALL_R; ball.vx = Math.abs(ball.vx); }
    if (ball.x + BALL_R >= GW) { ball.x = GW - BALL_R; ball.vx = -Math.abs(ball.vx); }
    if (ball.y - BALL_R <= 0) { ball.y = BALL_R; ball.vy = Math.abs(ball.vy); }

    // Paddle hit
    if (
      ball.y + BALL_R >= paddle.y &&
      ball.y - BALL_R <= paddle.y + paddle.h &&
      ball.x >= paddle.x &&
      ball.x <= paddle.x + paddle.w &&
      ball.vy > 0
    ) {
      const hitPos = (ball.x - paddle.x) / paddle.w;
      const angle = (hitPos - 0.5) * Math.PI * 0.6;
      const speed = Math.sqrt(ball.vx * ball.vx + ball.vy * ball.vy);
      ball.vx = Math.sin(angle) * speed;
      ball.vy = -Math.cos(angle) * speed;
      ball.y = paddle.y - BALL_R;
    }

    // Block collision
    for (const b of blocks) {
      if (!b.alive) continue;
      const closestX = Math.max(b.x, Math.min(ball.x, b.x + b.w));
      const closestY = Math.max(b.y, Math.min(ball.y, b.y + b.h));
      const dx = ball.x - closestX;
      const dy = ball.y - closestY;
      if (dx * dx + dy * dy < BALL_R * BALL_R) {
        b.alive = false;
        score += (ROWS - Math.floor((b.y - BLOCK_TOP) / (BLOCK_H + BLOCK_GAP))) * 10;
        if (Math.abs(dx) > Math.abs(dy)) {
          ball.vx = -ball.vx;
        } else {
          ball.vy = -ball.vy;
        }
        ball.vx *= 1.02;
        ball.vy *= 1.02;
        break;
      }
    }

    // Ball lost
    if (ball.y > GH) {
      lives--;
      if (lives <= 0) {
        gameOver = true;
        if (score > best) { best = score; Minimotor.Storage.save("breakout_best", best); }
      } else {
        resetBall();
      }
    }

    // All blocks cleared → next wave
    if (blocks.every((b) => !b.alive)) {
      spawnBlocks();
      ball.vx *= 1.15;
      ball.vy *= 1.15;
    }

    if (score > best) { best = score; Minimotor.Storage.save("breakout_best", best); }
  },
  () => {
    const ctx = Minimotor.Engine.ctx;

    // Clear entire canvas (letterbox background)
    ctx.clearRect(0, 0, vp.w, vp.h);
    ctx.fillStyle = "#0a0a0a";
    ctx.fillRect(0, 0, vp.w, vp.h);

    // Game area background
    ctx.fillStyle = "#151515";
    ctx.fillRect(ox, oy, GW * scale, GH * scale);

    // Draw game into the letterbox
    ctx.save();
    ctx.translate(ox, oy);
    ctx.scale(scale, scale);

    // Blocks
    for (const b of blocks) {
      if (!b.alive) continue;
      ctx.fillStyle = b.color;
      ctx.fillRect(b.x, b.y, b.w, b.h);
      ctx.fillStyle = "rgba(255,255,255,0.15)";
      ctx.fillRect(b.x, b.y, b.w, 4);
    }

    // Paddle
    ctx.fillStyle = "#fff";
    ctx.fillRect(paddle.x, paddle.y, paddle.w, paddle.h);
    ctx.fillStyle = "rgba(255,255,255,0.2)";
    ctx.fillRect(paddle.x, paddle.y, paddle.w, 3);

    // Ball
    ctx.fillStyle = "#fff";
    ctx.beginPath();
    ctx.arc(ball.x, ball.y, BALL_R, 0, Math.PI * 2);
    ctx.fill();

    // HUD
    ctx.fillStyle = "#fff";
    ctx.font = "14px monospace";
    ctx.fillText(`Score: ${score}  Best: ${best}  ${"♥".repeat(lives)}`, 10, 20);
    ctx.fillText("← → move  Space launch", 10, GH - 14);

    // Overlays
    if (waiting && !gameOver) {
      ctx.fillStyle = "rgba(0,0,0,0.4)";
      ctx.fillRect(0, 0, GW, GH);
      ctx.fillStyle = "#fff";
      ctx.font = "20px monospace";
      ctx.textAlign = "center";
      ctx.fillText("Press Space to launch", GW / 2, GH / 2);
      ctx.textAlign = "start";
    }
    if (gameOver) {
      ctx.fillStyle = "rgba(0,0,0,0.6)";
      ctx.fillRect(0, 0, GW, GH);
      ctx.fillStyle = "#ff6b6b";
      ctx.font = "bold 28px monospace";
      ctx.textAlign = "center";
      ctx.fillText("GAME OVER", GW / 2, GH / 2 - 14);
      ctx.fillStyle = "#fff";
      ctx.font = "16px monospace";
      ctx.fillText(`Score: ${score}  Best: ${best}`, GW / 2, GH / 2 + 22);
      ctx.textAlign = "start";
    }

    ctx.restore();
  },
);
