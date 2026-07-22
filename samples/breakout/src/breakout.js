// Breakout on Scenes + ECS.
// - Blocks are ECS entities (spawned per wave, queried for collision + render,
//   despawned on hit). Ball and paddle stay plain objects — single instances,
//   so entities would be overkill; the engine lets you mix freely.
// - Scenes drive the top-level states: "play" and a pushed "over" overlay, so
//   the final board still shows underneath the game-over text.
// Game runs in a fixed 400×700 logical space, letterboxed to the viewport.
import { Audio, Camera, Collision, Draw, ECS, Game, Keys, Loop, Perf, Scenes, Stage, UI } from "minimotor";
import { drawGameOver } from "../../shared/src/overlays.js";

// ---- ECS: one component holding a block's rect + presentation ----
const Block = ECS.component("Block"); // { x, y, w, h, color, row }
const world = ECS.create();

// The perf HUD shows this world's live entity count (`ents`).
// The viewport is LIVE (mutated on resize); the engine owns clearing.
const view = Stage.init("game", { background: "#111", plugins: [Perf.plugin({ world })] });

// Fixed game dimensions — scaled to fit the viewport, keeping aspect ratio.
const GW = 400;
const GH = 700;
let scale, ox, oy; // letterbox transform, recomputed on resize
function layout() {
  ({ scale, ox, oy } = Game.letterbox(GW, GH, view.w, view.h));
}
layout();
Stage.onResize(layout);

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
const scores = Game.createScoreTracker("breakout_best");
let lives = 3;
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

const scenes = Scenes.create({
  // ---------- Play scene ----------
  play: {
    enter() {
      world.clear();
      spawnWave();
      scores.reset();
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
        const c = Collision.circleRect(ball.x, ball.y, BALL_R, b);
        if (c) {
          world.despawn(e);
          Camera.shake(3, 120); // a little kick per broken block
          Audio.Sfx.blip(880 - b.row * 90, 0.06); // pitch by row — top rows ring higher
          const points = (ROWS - b.row) * 10;
          scores.add(points);
          // Floats live in game space (inside the letterbox transform), so they
          // scale and shake with the board.
          UI.float(`+${points}`, b.x + b.w / 2, b.y, { color: b.color });
          if (Math.abs(c.nx) > Math.abs(c.ny)) ball.vx = -ball.vx;
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
          scores.save();
          scenes.push("over"); // overlay; the board stays drawn underneath
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

    },

    draw() {
      const { ctx } = Draw;
      Game.drawLetterbox(ctx, view.w, view.h, GW, GH, "#0a0a0a", "#151515");

      ctx.save();
      ctx.translate(ox, oy);
      ctx.scale(scale, scale);
      // Shake the playfield only — the letterbox backdrop stays put. The
      // default camera is identity, so this block just applies the shake.
      Camera.render(() => {
        // Blocks (render straight from the ECS query)
        for (const [, b] of world.query(Block)) {
          Draw.rect(b, b.color);
          Draw.rect(b.x, b.y, b.w, 4, "rgba(255,255,255,0.15)");
        }

        Draw.rect(paddle, "#fff");
        Draw.rect(paddle.x, paddle.y, paddle.w, 3, "rgba(255,255,255,0.2)");

        Draw.circle(ball.x, ball.y, BALL_R, "#fff");

        // Board-space text = Draw.text (UI.text is ALWAYS screen space, and
        // this HUD lives inside the letterbox transform with the board).
        Draw.text(`Score: ${scores.score}  Best: ${scores.best}  ${"♥".repeat(lives)}`, { x: 10, y: 6, size: 14 });
        Draw.text("← → move  Space launch", { x: 10, y: GH - 28, size: 14 });

        UI.drawFloats(); // score pops, in game space

        if (waiting) {
          Draw.rect(0, 0, GW, GH, "rgba(0,0,0,0.4)");
          Draw.text("Press Space to launch", {
            x: GW / 2,
            y: GH / 2,
            font: "20px monospace",
            align: "center",
            baseline: "middle",
          });
        }
      });
      ctx.restore();
    },
  },

  // ---------- Game over (overlay pushed on top of the frozen board) ----------
  over: {
    update() {
      // go() exits the whole stack (this overlay + the frozen play) and enters a
      // fresh play scene — no need to pop() first.
      if (Keys.pressed("Space")) scenes.go("play");
    },
    draw() {
      const { ctx } = Draw;
      ctx.save();
      ctx.translate(ox, oy);
      ctx.scale(scale, scale);
      drawGameOver(GW, GH, scores.score, scores.best, "Space to play again");
      ctx.restore();
    },
  },
});

Loop.run(scenes); // "play" is the first key, so it opens
