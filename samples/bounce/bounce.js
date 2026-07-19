// Sample: Bouncing ball game using Minimotor engine
// Tests: game loop, collision, input, physics

import { Minimotor } from "../../build/index.js";

Minimotor.Engine.use(Minimotor.Perf.plugin());

const vp = Minimotor.Engine.initCanvas("game");

const BALL_SIZE = 30;
const MOVE_SPEED = 4;

const ball = {
  x: vp.w / 2,
  y: vp.h / 2,
  w: BALL_SIZE,
  h: BALL_SIZE,
  vx: 2,
  vy: 3,
};

let score = 0;
const best = Minimotor.Storage.load("bounce_best", 0);

const keys = {};
Minimotor.Engine.onKeyDown = (code) => { keys[code] = true; };
window.addEventListener("keyup", (e) => { keys[e.code] = false; });

function update() {
  // Player movement
  if (keys["ArrowLeft"]) ball.x -= MOVE_SPEED;
  if (keys["ArrowRight"]) ball.x += MOVE_SPEED;
  if (keys["ArrowUp"]) ball.y -= MOVE_SPEED;
  if (keys["ArrowDown"]) ball.y += MOVE_SPEED;

  // Ball physics
  ball.x += ball.vx;
  ball.y += ball.vy;

  // Bounce off walls
  if (ball.x < 0) { ball.x = 0; ball.vx = -ball.vx; score++; }
  if (ball.x + ball.w > vp.w) { ball.x = vp.w - ball.w; ball.vx = -ball.vx; score++; }
  if (ball.y < 0) { ball.y = 0; ball.vy = -ball.vy; score++; }
  if (ball.y + ball.h > vp.h) { ball.y = vp.h - ball.h; ball.vy = -ball.vy; score++; }

  if (score > best) {
    Minimotor.Storage.save("bounce_best", score);
  }
}

function draw() {
  const ctx = Minimotor.Engine.ctx;
  const fs = Minimotor.Engine.frameScale;

  ctx.clearRect(0, 0, vp.w, vp.h);

  // Ball
  ctx.fillStyle = "#ff6b6b";
  ctx.beginPath();
  ctx.arc(ball.x + ball.w / 2, ball.y + ball.h / 2, BALL_SIZE / 2, 0, Math.PI * 2);
  ctx.fill();

  // HUD
  ctx.fillStyle = "#fff";
  ctx.font = "16px monospace";
  ctx.fillText(`Score: ${score}  Best: ${Math.max(best, score)}`, 10, 24);
  ctx.fillText(`Ball: ${ball.x.toFixed(0)},${ball.y.toFixed(0)}  V: ${ball.vx.toFixed(1)},${ball.vy.toFixed(1)}`, 10, 46);
  ctx.fillText(`Arrow keys to move ball`, 10, vp.h - 10);
}

Minimotor.Engine.start(update, draw);
