// Breakout on Scenes + ECS.
// - Blocks are ECS entities (spawned per wave, queried for collision + render,
//   despawned on hit). Ball and paddle stay plain objects — single instances,
//   so entities would be overkill; the engine lets you mix freely.
// - Scenes drive the top-level states: "play" and a pushed "over" overlay, so
//   the final board still shows underneath the game-over text.
// Game runs in a fixed 400×700 logical space, letterboxed to the viewport.
import { Minimotor } from "minimotor";
import { drawGameOver } from "../shared/overlays.js";

const { Scenes, Keys, Draw, ECS, Collision, Mathf, Camera, Audio, UI } = Minimotor;

// ---- ECS: one component holding a block's rect + presentation ----
const Block = ECS.component("Block"); // { x, y, w, h, color, row }
const world = ECS.world();

// The perf HUD shows this world's live entity count (`ents`).
let vp = Minimotor.Stage.init("game", { plugins: [Minimotor.Perf.plugin({ world })] });

// Fixed game dimensions — scaled to fit the viewport, keeping aspect ratio.
const GW = 400;
const GH = 700;
let scale, ox, oy; // letterbox transform, recomputed on resize
function layout() {
  scale = Math.min(vp.w / GW, vp.h / GH);
  ox = (vp.w - GW * scale) / 2;
  oy = (vp.h - GH * scale) / 2;
}
layout();
Minimotor.Stage.onResize((next) => {
  vp = next;
  layout();
});

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
const ROW_COLORS = ["#ff6b6b", "#ffa94d", "#ffd43b", "#69db7c", "#4ecdc4"];

// ---- plain-object state (single instances) ----
const paddle = { x: GW / 2 - PADDLE_W / 2, y: GH - 60, w: PADDLE_W, h: PADDLE_H };
const ball = { x: GW / 2, y: GH - 80, r: BALL_R, vx: 2.5, vy: -2.5 };
let score = 0;
let lives = 3;
let best = Minimotor.Storage.load("breakout_best", 0);
let waiting = true; // ball sits on the paddle until launched

function spawnWave() {
  for (let row = 0; row < ROWS; row++) {
    for (let col = 0; col < COLS; col++) {
      world.spawn(
        Block.with({
          x: (GW - gridW) / 2 + col * (BLOCK_W + BLOCK_GAP),
          y: BLOCK_TOP + row * (BLOCK_H + BLOCK_GAP),
          w: BLOCK_W,
          h: BLOCK_H,
          color: ROW_COLORS[row],
          row,
        }),
      );
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

// ---------- Play scene ----------
Scenes.define("play", {
  enter() {
    world.clear();
    spawnWave();
    score = 0;
    lives = 3;
    paddle.x = GW / 2 - PADDLE_W / 2;
    UI.clearFloats();
    resetBall();
  },

  update() {
    // Paddle
    const speed = 6;
    if (Keys.down("ArrowLeft")) paddle.x = Math.max(0, paddle.x - speed);
    if (Keys.down("ArrowRight")) paddle.x = Math.min(GW - PADDLE_W, paddle.x + speed);

    if (waiting) {
      ball.x = paddle.x + paddle.w / 2;
      if (Keys.down("Space") || Keys.down("ArrowUp")) waiting = false;
      return;
    }

    ball.x += ball.vx;
    ball.y += ball.vy;

    // Walls
    if (ball.x - BALL_R <= 0) {
      ball.x = BALL_R;
      ball.vx = Math.abs(ball.vx);
    }
    if (ball.x + BALL_R >= GW) {
      ball.x = GW - BALL_R;
      ball.vx = -Math.abs(ball.vx);
    }
    if (ball.y - BALL_R <= 0) {
      ball.y = BALL_R;
      ball.vy = Math.abs(ball.vy);
    }

    // Paddle
    if (
      ball.y + BALL_R >= paddle.y &&
      ball.y - BALL_R <= paddle.y + paddle.h &&
      ball.x >= paddle.x &&
      ball.x <= paddle.x + paddle.w &&
      ball.vy > 0
    ) {
      const hitPos = (ball.x - paddle.x) / paddle.w;
      const angle = (hitPos - 0.5) * Math.PI * 0.6;
      const spd = Math.hypot(ball.vx, ball.vy);
      ball.vx = Math.sin(angle) * spd;
      ball.vy = -Math.cos(angle) * spd;
      ball.y = paddle.y - BALL_R;
      Audio.Sfx.blip(520, 0.05);
    }

    // Blocks — query the ECS, bounce off the first hit and despawn it. Despawn
    // during a query is safe: the world buffers it until iteration finishes.
    for (const [e, b] of world.query(Block)) {
      const closestX = Mathf.clamp(ball.x, b.x, b.x + b.w);
      const closestY = Mathf.clamp(ball.y, b.y, b.y + b.h);
      const dx = ball.x - closestX;
      const dy = ball.y - closestY;
      if (dx * dx + dy * dy < BALL_R * BALL_R) {
        world.despawn(e);
        Camera.shake(3, 120); // a little kick per broken block
        Audio.Sfx.blip(880 - b.row * 90, 0.06); // pitch by row — top rows ring higher
        const points = (ROWS - b.row) * 10;
        score += points;
        // Floats live in game space (inside the letterbox transform), so they
        // scale and shake with the board.
        UI.float(`+${points}`, b.x + b.w / 2, b.y, { color: b.color });
        if (Math.abs(dx) > Math.abs(dy)) ball.vx = -ball.vx;
        else ball.vy = -ball.vy;
        ball.vx *= 1.02;
        ball.vy *= 1.02;
        break;
      }
    }

    // Ball lost
    if (ball.y > GH) {
      lives--;
      Camera.shake(9, 350); // losing a life hits harder
      Audio.Sfx.blip(130, 0.35);
      if (lives <= 0) {
        best = Math.max(best, score);
        Minimotor.Storage.save("breakout_best", best);
        Scenes.push("over"); // overlay; the board stays drawn underneath
      } else {
        resetBall();
      }
    }

    // Wave cleared → next wave, faster
    if (world.count(Block) === 0) {
      spawnWave();
      ball.vx *= 1.15;
      ball.vy *= 1.15;
    }

    if (score > best) {
      best = score;
      Minimotor.Storage.save("breakout_best", best);
    }
  },

  draw() {
    const { ctx } = Draw;
    ctx.clearRect(0, 0, vp.w, vp.h);
    ctx.fillStyle = "#0a0a0a";
    ctx.fillRect(0, 0, vp.w, vp.h);
    ctx.fillStyle = "#151515";
    ctx.fillRect(ox, oy, GW * scale, GH * scale);

    ctx.save();
    ctx.translate(ox, oy);
    ctx.scale(scale, scale);
    // Shake the playfield only — the letterbox backdrop stays put.
    ctx.translate(Camera.shakeX(), Camera.shakeY());

    // Blocks (render straight from the ECS query)
    for (const [, b] of world.query(Block)) {
      ctx.fillStyle = b.color;
      ctx.fillRect(b.x, b.y, b.w, b.h);
      ctx.fillStyle = "rgba(255,255,255,0.15)";
      ctx.fillRect(b.x, b.y, b.w, 4);
    }

    ctx.fillStyle = "#fff";
    ctx.fillRect(paddle.x, paddle.y, paddle.w, paddle.h);
    ctx.fillStyle = "rgba(255,255,255,0.2)";
    ctx.fillRect(paddle.x, paddle.y, paddle.w, 3);

    ctx.fillStyle = "#fff";
    ctx.beginPath();
    ctx.arc(ball.x, ball.y, BALL_R, 0, Math.PI * 2);
    ctx.fill();

    UI.text(`Score: ${score}  Best: ${best}  ${"♥".repeat(lives)}`, { x: 10, y: 6, size: 14 });
    UI.text("← → move  Space launch", { x: 10, y: GH - 28, size: 14 });

    UI.drawFloats(); // score pops, in game space

    if (waiting) {
      ctx.fillStyle = "rgba(0,0,0,0.4)";
      ctx.fillRect(0, 0, GW, GH);
      Minimotor.Text.drawCentered(ctx, "Press Space to launch", GW / 2, GH / 2, {
        font: "20px monospace",
      });
    }
    ctx.restore();
  },
});

// ---------- Game over (overlay pushed on top of the frozen board) ----------
Scenes.define("over", {
  update() {
    // go() exits the whole stack (this overlay + the frozen play) and enters a
    // fresh play scene — no need to pop() first.
    if (Keys.pressed("Space")) Scenes.go("play");
  },
  draw() {
    const { ctx } = Draw;
    ctx.save();
    ctx.translate(ox, oy);
    ctx.scale(scale, scale);
    drawGameOver(ctx, GW, GH, score, best, "Space to play again");
    ctx.restore();
  },
});

Scenes.go("play");
