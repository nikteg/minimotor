import { createDebug } from "minimotor/debug";
// Breakout on Scenes + ECS.
// - Blocks are ECS entities (spawned per wave, queried for collision + render,
//   despawned on hit). Ball and paddle stay plain objects — single instances,
//   so entities would be overkill; the engine lets you mix freely.
// - Scenes drive the top-level states: "play" and a pushed "over" overlay, so
//   the final board still shows underneath the game-over text.
// - The stage runs at a FIXED 400×700 resolution, letterboxed into the window
//   by the engine — no manual save/translate/scale, and view.w/view.h ARE the
//   logical size. The pointer and all drawing are in board coordinates.
import { createAudio } from "minimotor/audio";
import { createCamera } from "minimotor/camera";
import { createScenes } from "minimotor/scenes";
import { createUI } from "minimotor/ui";
import { Collision, Gizmos, Mathf, createApp, Vec2 } from "minimotor";
import { component, createEcs } from "minimotor/ecs";
import { createOverlays } from "../shared/overlays.ts";

const GW = 400;
const GH = 700;

// ---- ECS: one component holding a block's rect + presentation ----
interface BlockData {
  x: number;
  y: number;
  w: number;
  h: number;
  color: string;
  row: number;
}
const Block = component<BlockData>("Block");
const ecs = createEcs();

// Fixed-resolution stage: the engine fits GW×GH into the window (play area
// "#151515", letterbox bars "#0a0a0a"). The perf HUD shows live entity count.
const game = createApp("game", {
  resolution: { w: GW, h: GH },
  background: "#151515",
  barColor: "#0a0a0a",
  preventNavigation: true,
});
createDebug(game, { initial: "performance", perf: { world: ecs } });
const { Draw, Keys, Loop } = game;
const { drawGameOver } = createOverlays(Draw);
const Audio = createAudio(game);
const Camera = createCamera(game);
const Scenes = createScenes(game);
const UI = createUI(game);

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
const ball = { x: GW / 2, y: GH - 80, r: BALL_R, vel: { x: 2.5, y: -2.5 } };
const scores = Gizmos.scoreTracker("breakout_best");
let lives = 3;
let waiting = true; // ball sits on the paddle until launched

function spawnWave() {
  for (let row = 0; row < ROWS; row++) {
    for (let col = 0; col < COLS; col++) {
      ecs.spawn(
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
  ball.vel.x = (Math.random() > 0.5 ? 1 : -1) * 2.5;
  ball.vel.y = -2.5;
  waiting = true;
}

const scenes = Scenes.create({
  // ---------- Play scene ----------
  play: {
    enter() {
      ecs.clear();
      spawnWave();
      scores.reset();
      lives = 3;
      paddle.x = GW / 2 - PADDLE_W / 2;
      UI.clearFloatText();
      resetBall();
    },

    update() {
      // Paddle
      const speed = 6;
      if (Keys.down("ArrowLeft")) paddle.x = Mathf.clamp(paddle.x - speed, 0, GW - PADDLE_W);
      if (Keys.down("ArrowRight")) paddle.x = Mathf.clamp(paddle.x + speed, 0, GW - PADDLE_W);

      if (waiting) {
        ball.x = paddle.x + paddle.w / 2;
        if (Keys.down("Space") || Keys.down("ArrowUp")) waiting = false;
        return;
      }

      Vec2.add(ball, ball.vel); // integrate

      // Walls — three sides only (the bottom is a lost ball, handled below).
      if (ball.x - BALL_R <= 0) {
        ball.x = BALL_R;
        ball.vel.x = Math.abs(ball.vel.x);
      }
      if (ball.x + BALL_R >= GW) {
        ball.x = GW - BALL_R;
        ball.vel.x = -Math.abs(ball.vel.x);
      }
      if (ball.y - BALL_R <= 0) {
        ball.y = BALL_R;
        ball.vel.y = Math.abs(ball.vel.y);
      }

      // Paddle: circleRect detects the contact; the english (angle from where
      // it struck the paddle) is game policy on top of the primitive.
      if (ball.vel.y > 0 && Collision.circleRect(ball.x, ball.y, BALL_R, paddle)) {
        const hitPos = (ball.x - paddle.x) / paddle.w;
        const angle = (hitPos - 0.5) * Math.PI * 0.6;
        const spd = Vec2.len(ball.vel);
        ball.vel.x = Math.sin(angle) * spd;
        ball.vel.y = -Math.cos(angle) * spd;
        ball.y = paddle.y - BALL_R;
        Audio.Sfx.blip(520, 0.05);
      }

      // Blocks — query the bounce off the first hit and despawn it. Despawn
      // during a query is safe: the world buffers it until iteration finishes.
      for (const [e, b] of ecs.query(Block)) {
        const c = Collision.circleRect(ball.x, ball.y, BALL_R, b);
        if (c) {
          ecs.despawn(e);
          Camera.shake(3, 120); // a little kick per broken block
          Audio.Sfx.blip(880 - b.row * 90, 0.06); // pitch by row — top rows ring higher
          const points = (ROWS - b.row) * 10;
          scores.add(points);
          // Floating score pops live in board space (they scale with the board).
          UI.floatText(`+${points}`, b.x + b.w / 2, b.y, { color: b.color });
          if (Math.abs(c.nx) > Math.abs(c.ny)) ball.vel.x = -ball.vel.x;
          else ball.vel.y = -ball.vel.y;
          Vec2.scale(ball.vel, 1.02);
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
      if (ecs.count(Block) === 0) {
        spawnWave();
        Vec2.scale(ball.vel, 1.15);
      }
    },

    draw() {
      // Shake the playfield only (primary camera is identity — this applies the
      // shake). Everything is already in board space thanks to `resolution`.
      Camera.render(() => {
        // Draw pass: just the block data, no entity id → dense() (the
        // collision loop above keeps query() because it despawns).
        for (const b of ecs.dense(Block)) {
          Draw.rect(b, b.color);
          Draw.rect(b.x, b.y, b.w, 4, "rgba(255,255,255,0.15)");
        }

        Draw.rect(paddle, "#fff");
        Draw.rect(paddle.x, paddle.y, paddle.w, 3, "rgba(255,255,255,0.2)");
        Draw.circle(ball.x, ball.y, BALL_R, "#fff");

        Draw.text(`Score: ${scores.score}  Best: ${scores.best}  ${"♥".repeat(lives)}`, {
          x: 10,
          y: 6,
          size: 14,
        });
        Draw.text("← → move  Space launch", { x: 10, y: GH - 28, size: 14 });

        UI.drawFloatText(); // score pops, in board space

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
      drawGameOver(GW, GH, scores.score, scores.best, "Space to play again");
    },
  },
});

Loop.run(scenes); // "play" is the first key, so it opens
