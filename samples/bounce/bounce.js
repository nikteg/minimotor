// Sample: Bouncing ball game using Minimotor engine
// Tests: game loop, collision, input, physics

import { Minimotor } from "minimotor";

let vp = Minimotor.Stage.init("game", { plugins: [Minimotor.Perf.plugin()] });
Minimotor.Stage.onResize((next) => (vp = next)); // wall bounds read vp live

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

Minimotor.Loop.run({
  update() {
    const { Keys } = Minimotor;
    // Player movement
    if (Keys.down("ArrowLeft")) ball.x -= MOVE_SPEED;
    if (Keys.down("ArrowRight")) ball.x += MOVE_SPEED;
    if (Keys.down("ArrowUp")) ball.y -= MOVE_SPEED;
    if (Keys.down("ArrowDown")) ball.y += MOVE_SPEED;

    // Ball physics
    ball.x += ball.vx;
    ball.y += ball.vy;

    // Bounce off walls
    const wasScore = score;
    if (ball.x < 0) { ball.x = 0; ball.vx = -ball.vx; score++; }
    if (ball.x + ball.w > vp.w) { ball.x = vp.w - ball.w; ball.vx = -ball.vx; score++; }
    if (ball.y < 0) { ball.y = 0; ball.vy = -ball.vy; score++; }
    if (ball.y + ball.h > vp.h) { ball.y = vp.h - ball.h; ball.vy = -ball.vy; score++; }
    if (score > wasScore) Minimotor.Audio.Sfx.blip(440 + (score % 8) * 60, 0.06);

    if (score > best) {
      Minimotor.Storage.save("bounce_best", score);
    }
  },
  draw() {
    const { ctx } = Minimotor.Draw;
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
  },
});
