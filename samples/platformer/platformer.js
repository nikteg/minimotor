// Platformer: side-scrolling Mario-like with platforms, coins, enemies, and flag goal.
// Demonstrates: Physics (gravity, jump), Collision, input, scoring, storage,
//   camera scrolling, parallax backgrounds
import { Minimotor } from "minimotor";
import { drawGameOver, drawLevelComplete } from "../shared/overlays.js";

const vp = Minimotor.Stage.init("game", { plugins: [Minimotor.Perf.plugin()] });

// World
const WORLD_W = 3600;
const WORLD_H = 600; // fixed height
const GROUND_Y = WORLD_H - 40;

// Player
const PLAYER_W = 28;
const PLAYER_H = 32;
const MOVE_SPEED = 4;
const GRAVITY = Minimotor.Physics.GRAVITY;
const JUMP_FORCE = Minimotor.Physics.JUMP_FORCE;

let player = {
  x: 40, y: GROUND_Y - PLAYER_H,
  w: PLAYER_W, h: PLAYER_H,
  vx: 0, vy: 0, onGround: false,
  facing: 1, // 1 = right, -1 = left
};

// Platforms: [x, y, w, h, color]
const platforms = [
  [0, GROUND_Y, WORLD_W, 40, "#5c4033"],                        // ground
  [200, GROUND_Y - 100, 120, 16, "#8b4513"],                    // platform 1
  [400, GROUND_Y - 180, 100, 16, "#8b4513"],                    // platform 2
  [600, GROUND_Y - 120, 160, 16, "#8b4513"],                    // platform 3
  [850, GROUND_Y - 200, 100, 16, "#8b4513"],                    // high platform
  [1050, GROUND_Y - 140, 140, 16, "#8b4513"],                   // platform 4
  [1300, GROUND_Y - 90, 80, 16, "#8b4513"],                     // step
  [1400, GROUND_Y - 180, 80, 16, "#8b4513"],                    // step high
  [1600, GROUND_Y - 120, 200, 16, "#8b4513"],                   // long platform
  [1900, GROUND_Y - 200, 100, 16, "#8b4513"],                   // high
  [2100, GROUND_Y - 100, 120, 16, "#8b4513"],                   // mid
  [2300, GROUND_Y - 160, 180, 16, "#8b4513"],                   // wide
  [2600, GROUND_Y - 220, 90, 16, "#8b4513"],                    // top
  [2800, GROUND_Y - 120, 160, 16, "#8b4513"],                   // approach
];

// Coins: [x, y]
const coinPositions = [
  [220, GROUND_Y - 140], [260, GROUND_Y - 140],
  [420, GROUND_Y - 220], [460, GROUND_Y - 220],
  [620, GROUND_Y - 160], [680, GROUND_Y - 160], [720, GROUND_Y - 160],
  [880, GROUND_Y - 240],
  [1070, GROUND_Y - 180], [1110, GROUND_Y - 180], [1150, GROUND_Y - 180],
  [1620, GROUND_Y - 160], [1680, GROUND_Y - 160], [1740, GROUND_Y - 160],
  [1930, GROUND_Y - 240],
  [2120, GROUND_Y - 140], [2160, GROUND_Y - 140],
  [2320, GROUND_Y - 200], [2360, GROUND_Y - 200], [2400, GROUND_Y - 200], [2440, GROUND_Y - 200],
  [2640, GROUND_Y - 260],
  [2820, GROUND_Y - 160], [2900, GROUND_Y - 160],
  // Ground coins
  [350, GROUND_Y - 24], [380, GROUND_Y - 24],
  [1000, GROUND_Y - 24], [1030, GROUND_Y - 24],
  [1500, GROUND_Y - 24], [1530, GROUND_Y - 24],
  [2000, GROUND_Y - 24], [2030, GROUND_Y - 24],
  [2500, GROUND_Y - 24], [2530, GROUND_Y - 24],
];

// Enemies: [x, y, w, h, patrolLeft, patrolRight]
const enemyDefs = [
  [500, GROUND_Y - 24, 24, 24, 440, 560],
  [900, GROUND_Y - 24, 24, 24, 850, 1000],
  [1200, GROUND_Y - 24, 24, 24, 1150, 1300],
  [1700, GROUND_Y - 24, 24, 24, 1650, 1850],
  [2200, GROUND_Y - 24, 24, 24, 2150, 2350],
  [2700, GROUND_Y - 24, 24, 24, 2650, 2850],
];

// Flag
const FLAG_X = 3200;
const FLAG_Y = GROUND_Y - 160;

// State
let coins = [];
let enemies = [];
let cameraX = 0;
let score = 0;
let coinCount = 0;
let lives = 3;
let best = Minimotor.Storage.load("platformer_best", 0);
let gameOver = false;
let levelComplete = false;
let invincible = 0; // frames of invincibility after taking damage
let animFrame = 0;

function restart() {
  player.x = 40; player.y = GROUND_Y - PLAYER_H;
  player.vx = 0; player.vy = 0; player.onGround = false; player.facing = 1;
  cameraX = 0;
  if (score > best) { best = score; Minimotor.Storage.save("platformer_best", best); }
  score = 0; coinCount = 0;
  lives = 3;
  gameOver = false;
  levelComplete = false;
  invincible = 0;
  initCoins();
  initEnemies();
}

function initCoins() {
  coins = coinPositions.map(([x, y]) => ({ x, y, collected: false }));
}

function initEnemies() {
  enemies = enemyDefs.map(([x, y, w, h, pl, pr]) => ({
    x, y, w, h, vx: 1.5, patrolLeft: pl, patrolRight: pr, alive: true,
  }));
}

initCoins();
initEnemies();

// ---------- Physics helpers ----------

function platformCollisionY(body, py, ph) {
  const prevBottom = body.y + body.h - body.vy;
  const landing = prevBottom <= py && body.y + body.h >= py && body.vy >= 0;
  if (landing) {
    body.y = py - body.h;
    body.vy = 0;
    body.onGround = true;
    return true;
  }
  // Head bump (jumping into bottom of platform)
  if (body.vy < 0 && body.y <= py + ph && body.y + body.h > py + ph) {
    body.y = py + ph;
    body.vy = 0;
  }
  return false;
}

function bodyOnPlatform(body, px, py, pw, ph) {
  return (
    body.x + body.w > px && body.x < px + pw &&
    body.y + body.h >= py && body.y + body.h <= py + ph + 6 &&
    body.vy >= 0
  );
}

// ---------- Game loop ----------

Minimotor.Loop.run({
  update() {
    const { Keys } = Minimotor;
    // Edge-triggered restarts (polled, no key-event callback).
    if (gameOver && Keys.pressed("Space")) restart();
    if ((levelComplete || gameOver) && Keys.pressed("KeyR")) restart();
    if (gameOver || levelComplete) return;
    animFrame++;

    // Invincibility countdown
    if (invincible > 0) invincible--;

    // Player horizontal movement
    const left = Keys.down("ArrowLeft") || Keys.down("KeyA");
    const right = Keys.down("ArrowRight") || Keys.down("KeyD");
    const jumpHeld = Keys.down("Space") || Keys.down("ArrowUp") || Keys.down("KeyW");
    player.vx = 0;
    if (left) { player.vx = -MOVE_SPEED; player.facing = -1; }
    if (right) { player.vx = MOVE_SPEED; player.facing = 1; }

    // Jump
    if (jumpHeld && player.onGround) {
      player.vy = JUMP_FORCE;
      player.onGround = false;
    }
    // Variable jump height — release early to shorten
    if (!jumpHeld && player.vy < -4) {
      player.vy *= 0.65;
    }

    // Gravity
    player.vy += GRAVITY;
    player.y += player.vy;
    player.x += player.vx;

    // Clamp to world bounds
    player.x = Math.max(0, Math.min(WORLD_W - PLAYER_W, player.x));

    // Platform collision
    player.onGround = false;
    for (const [px, py, pw, ph] of platforms) {
      if (bodyOnPlatform(player, px, py, pw, ph)) {
        platformCollisionY(player, py, ph);
      }
    }

    // Fell into pit
    if (player.y > WORLD_H + 50) {
      takeDamage();
    }

    // Coin collection
    for (const c of coins) {
      if (c.collected) continue;
      if (
        player.x + player.w > c.x - 8 && player.x < c.x + 8 &&
        player.y + player.h > c.y - 8 && player.y < c.y + 8
      ) {
        c.collected = true;
        score += 100;
        coinCount++;
      }
    }

    // Enemies
    for (const e of enemies) {
      if (!e.alive) continue;
      // Patrol
      e.x += e.vx;
      if (e.x <= e.patrolLeft) { e.x = e.patrolLeft; e.vx = Math.abs(e.vx); }
      if (e.x + e.w >= e.patrolRight) { e.x = e.patrolRight - e.w; e.vx = -Math.abs(e.vx); }

      // Collision with player
      if (
        player.x + player.w > e.x + 4 && player.x < e.x + e.w - 4 &&
        player.y + player.h > e.y + 4 && player.y < e.y + e.h - 4
      ) {
        // Stomping (player falling onto enemy top)
        if (player.vy > 0 && player.y + player.h - player.vy <= e.y + 8) {
          e.alive = false;
          player.vy = JUMP_FORCE * 0.6;
          score += 200;
        } else if (invincible === 0) {
          takeDamage();
        }
      }
    }

    // Flag / goal
    if (
      player.x + player.w > FLAG_X - 16 && player.x < FLAG_X + 16 &&
      player.y + player.h > FLAG_Y - 80 && player.y < FLAG_Y + 120
    ) {
      levelComplete = true;
      score += 1000 + coinCount * 50;
      if (score > best) { best = score; Minimotor.Storage.save("platformer_best", best); }
    }

    // Camera
    const targetCX = player.x - vp.w / 3;
    cameraX += (targetCX - cameraX) * 0.1;
    cameraX = Math.max(0, Math.min(WORLD_W - vp.w, cameraX));
  },
  draw() {
    const { ctx } = Minimotor.Draw;
    ctx.clearRect(0, 0, vp.w, vp.h);

    // Sky gradient
    const grad = ctx.createLinearGradient(0, 0, 0, vp.h);
    grad.addColorStop(0, "#5c94fc");
    grad.addColorStop(0.5, "#87ceeb");
    grad.addColorStop(1, "#b0e0e6");
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, vp.w, vp.h);

    // Clouds (parallax)
    ctx.fillStyle = "rgba(255,255,255,0.8)";
    const drawCloud = (wx, wy, s) => {
      const sx = wx - cameraX * 0.2;
      if (sx < -100 || sx > vp.w + 100) return;
      ctx.beginPath();
      ctx.arc(sx, wy, s * 20, 0, Math.PI * 2);
      ctx.arc(sx + s * 15, wy - s * 8, s * 16, 0, Math.PI * 2);
      ctx.arc(sx + s * 30, wy, s * 18, 0, Math.PI * 2);
      ctx.fill();
    };
    drawCloud(200, 60, 1);
    drawCloud(700, 40, 1.3);
    drawCloud(1400, 80, 0.8);
    drawCloud(2200, 50, 1.1);
    drawCloud(3000, 70, 0.9);

    // Hills (parallax)
    ctx.fillStyle = "#7ec850";
    for (let i = 0; i < 12; i++) {
      const hx = i * 320 - (cameraX * 0.3) % 320;
      ctx.beginPath();
      ctx.arc(hx, GROUND_Y, 120, 0, Math.PI, true);
      ctx.fill();
    }

    // Platforms
    for (const [px, py, pw, ph, color] of platforms) {
      const sx = px - cameraX;
      if (sx + pw < -10 || sx > vp.w + 10) continue;

      // Dirt
      ctx.fillStyle = color;
      ctx.fillRect(sx, py, pw, ph);

      if (ph > 20) {
        // Ground: grass top + dirt pattern
        ctx.fillStyle = "#4a8c2a";
        ctx.fillRect(sx, py, pw, 4);
        // Dirt lines
        ctx.strokeStyle = "#4a3520";
        ctx.lineWidth = 1;
        for (let lx = Math.floor(sx / 40) * 40; lx < sx + pw; lx += 40) {
          ctx.beginPath();
          ctx.moveTo(lx, py + 8);
          ctx.lineTo(lx + 20, py + 20);
          ctx.stroke();
        }
      } else {
        // Thin platform: highlight top
        ctx.fillStyle = "rgba(255,255,255,0.2)";
        ctx.fillRect(sx, py, pw, 3);
      }
    }

    // Coins
    const coinBob = Math.sin(animFrame * 0.08) * 3;
    for (const c of coins) {
      if (c.collected) continue;
      const sx = c.x - cameraX;
      if (sx < -10 || sx > vp.w + 10) continue;
      ctx.fillStyle = "#ffd700";
      ctx.beginPath();
      ctx.arc(sx, c.y + coinBob, 7, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = "#ffec80";
      ctx.beginPath();
      ctx.arc(sx, c.y + coinBob, 4, 0, Math.PI * 2);
      ctx.fill();
    }

    // Enemies
    for (const e of enemies) {
      if (!e.alive) continue;
      const sx = e.x - cameraX;
      if (sx + e.w < -10 || sx > vp.w + 10) continue;

      // Body
      ctx.fillStyle = "#c0392b";
      ctx.fillRect(sx, e.y, e.w, e.h);
      // Eyes
      ctx.fillStyle = "#fff";
      ctx.fillRect(sx + 4, e.y + 4, 6, 6);
      ctx.fillRect(sx + e.w - 10, e.y + 4, 6, 6);
      ctx.fillStyle = "#111";
      const pupilOff = e.vx > 0 ? 2 : 0;
      ctx.fillRect(sx + 5 + pupilOff, e.y + 5, 3, 3);
      ctx.fillRect(sx + e.w - 9 + pupilOff, e.y + 5, 3, 3);
      // Feet
      ctx.fillStyle = "#111";
      ctx.fillRect(sx, e.y + e.h - 4, e.w, 4);
    }

    // Flag
    {
      const fx = FLAG_X - cameraX;
      // Pole
      ctx.fillStyle = "#888";
      ctx.fillRect(fx - 2, FLAG_Y, 4, 120);
      // Ball on top
      ctx.fillStyle = "#ffd700";
      ctx.beginPath();
      ctx.arc(fx, FLAG_Y, 6, 0, Math.PI * 2);
      ctx.fill();
      // Flag
      ctx.fillStyle = "#2ecc71";
      ctx.beginPath();
      ctx.moveTo(fx, FLAG_Y + 8);
      ctx.lineTo(fx + 30, FLAG_Y + 18);
      ctx.lineTo(fx, FLAG_Y + 28);
      ctx.fill();
    }

    // Player
    {
      const blink = invincible > 0 && Math.floor(invincible / 4) % 2 === 0;
      if (!blink) {
        // Body
        ctx.fillStyle = "#e74c3c";
        const px = player.x - cameraX;
        ctx.fillRect(px + 2, player.y + PLAYER_H * 0.4, PLAYER_W - 4, PLAYER_H * 0.5);

        // Head
        ctx.fillStyle = "#f5cba7";
        ctx.fillRect(px + 4, player.y + 4, PLAYER_W - 8, PLAYER_H * 0.35);

        // Hat
        ctx.fillStyle = "#e74c3c";
        ctx.fillRect(px, player.y, PLAYER_W, player.y + 8 - player.y);
        ctx.fillRect(px + 2, player.y + 4, player.facing > 0 ? PLAYER_W + 4 : PLAYER_W, 6);

        // Eyes
        ctx.fillStyle = "#111";
        const eyeX = player.facing > 0 ? px + PLAYER_W - 12 : px + 6;
        ctx.fillRect(eyeX, player.y + 8, 3, 3);

        // Legs
        const legOff = player.onGround ? Math.sin(animFrame * 0.2) * (player.vx !== 0 ? 3 : 0) : 2;
        ctx.fillStyle = "#2c3e50";
        ctx.fillRect(px + 4, player.y + PLAYER_H * 0.85, 8, PLAYER_H * 0.15);
        ctx.fillRect(px + PLAYER_W - 12, player.y + PLAYER_H * 0.85, 8, PLAYER_H * 0.15);
      }
    }

    // HUD
    ctx.fillStyle = "rgba(0,0,0,0.5)";
    ctx.fillRect(0, 0, vp.w, 28);
    ctx.fillStyle = "#fff";
    ctx.font = "14px monospace";
    ctx.fillText(
      `Score: ${score}  Best: ${best}  Coins: ${coinCount}  ${"♥".repeat(lives)}`,
      10, 20,
    );
    ctx.fillText("← → move  Space jump", vp.w - 190, 20);

    // Game Over overlay
    if (gameOver) {
      drawGameOver(ctx, vp.w, vp.h, score, best, "Press Space to restart");
    }

    // Level Complete overlay
    if (levelComplete) {
      drawLevelComplete(
        ctx,
        vp.w,
        vp.h,
        score,
        `Coins: ${coinCount}  Bonus: +${1000 + coinCount * 50}`,
        "Press R to replay",
      );
    }
  },
});

function takeDamage() {
  if (invincible > 0) return;
  lives--;
  invincible = 90;
  if (lives <= 0) {
    gameOver = true;
    if (score > best) { best = score; Minimotor.Storage.save("platformer_best", best); }
  } else {
    // Reset position
    player.x = Math.max(40, player.x - 100);
    player.y = GROUND_Y - PLAYER_H;
    player.vy = 0;
    player.onGround = false;
    cameraX = Math.max(0, player.x - vp.w / 3);
  }
}
