// PIXEL ADVENTURE — a polished mini-platformer on Pixel Frog's CC0 itch.io kit.
// The headline: the player ships as one PNG PER STATE (idle/run/jump/fall/hit),
// so it's the poster child for `Anim.states` — the multi-image companion to
// `Anim.sheet`. Also shows loaded JSON + images, a `Tiles.grid` built from the
// numeric level with autotiled terrain, `Collision.moveAndSlide` against it,
// the follow camera, `Audio.tone` SFX, particles, float-text and a fixed-
// resolution letterboxed stage.
// Controls: A/D or arrows move; W/Up/Space jump (coyote + buffered, wall jump);
// R restarts.
import {
  Anim,
  Assets,
  Audio,
  Camera,
  Collision,
  Draw,
  Input,
  Keys,
  Loop,
  Mathf,
  OnscreenInput,
  Particles,
  Perf,
  Sprites,
  Stage,
  Tiles,
  Timers,
  UI,
} from "minimotor";
import type { Level, StateCursor, SheetCursor, MoverBody } from "minimotor";

// A fixed 480×270 logical stage, letterboxed into the window by the engine —
// world and HUD both draw in this space (no manual letterbox math).
const GAME_W = 480;
const GAME_H = 270;
const TILE = 48; // collision cell (world px)
const FW = 32; // player frame size in its source strips
Stage.init("game", {
  resolution: { w: GAME_W, h: GAME_H },
  preventNavigation: true,
  plugins: [Perf.plugin()],
});

// On-screen touch gamepad — renders in the true window corners (outside the
// letterbox bars), auto-hidden on desktop and shown on touch devices.
const pad = OnscreenInput.gamepad({
  opacity: 0.55,
  stick: { anchor: { side: "left", x: 84, y: 84 }, radius: 54 },
  buttons: [{ anchor: { side: "right", x: 70, y: 74 }, r: 34, button: "a", label: "JUMP" }],
});

const input = Input.map(
  {
    left: ["ArrowLeft", "KeyA", "pad:dpad-left", "pad:lstick-left"],
    right: ["ArrowRight", "KeyD", "pad:dpad-right", "pad:lstick-right"],
    jump: ["ArrowUp", "KeyW", "Space", "pad:a"],
  },
  { pad },
);

// -- Feel constants, in per-step units (px/step, px/step²) --------------------
const MOVE = 2.6; // top run speed
const ACCEL = 0.6; // ground/air acceleration toward MOVE
const FRICTION = 0.35; // decel when no input
const GRAVITY = 0.42;
const MAX_FALL = 11;
const JUMP = -9.4; // clears the opening ledge with the coyote/buffer gate
const JUMP_CUTOFF = 0.5; // variable-height: shorten on early release
const WALL_SLIDE = 2; // capped fall speed while clinging
const WALL_JUMP_X = 4.6;
const WALL_JUMP_Y = -8.6;
const STOMP_BOUNCE = -5.4;
const ENEMY_SPEED = 0.8;

// Forgiving jump: coyote grace after a ledge + a buffered press before landing.
const jumpGate = Timers.jumpGate({ coyoteMs: 90, bufferMs: 120 });

// -- Audio: layered synth SFX via Audio.tone (a pitched voice + a filtered
//    noise transient), on the default sfx bus. ------------------------------
const pitched = (
  wave: "sine" | "square" | "triangle" | "sawtooth",
  f0: number,
  f1: number,
  dur: number,
  gain: number,
  delay = 0,
) => Audio.tone({ wave, freq: f1 ? { from: f0, to: f1 } : f0, release: dur, gain, delay });
const noiseHit = (f0: number, f1: number, q: number, dur: number, gain: number) =>
  Audio.tone({
    wave: "noise",
    release: dur,
    gain,
    filter: { type: "bandpass", freq: { from: f0, to: f1 }, q },
  });
const arp = (
  wave: "sine" | "square" | "triangle" | "sawtooth",
  notes: number[],
  dur: number,
  gain: number,
  step: number,
) => notes.forEach((f, i) => pitched(wave, f, 0, dur, gain, i * step));

const SFX = {
  jump: () => {
    pitched("triangle", 300, 640, 0.13, 0.22);
    noiseHit(900, 1800, 4, 0.08, 0.05);
  },
  coin: () => {
    arp("sine", [1046, 1318, 1568], 0.2, 0.16, 0.05);
    noiseHit(3200, 3200, 9, 0.16, 0.04);
  },
  stomp: () => {
    Audio.tone({
      wave: "noise",
      release: 0.14,
      gain: 0.18,
      filter: { type: "lowpass", freq: { from: 700, to: 140 } },
    });
    pitched("square", 240, 70, 0.13, 0.14);
  },
  hurt: () => {
    pitched("sawtooth", 400, 90, 0.3, 0.2);
    Audio.tone({
      wave: "noise",
      release: 0.28,
      gain: 0.09,
      filter: { type: "lowpass", freq: { from: 1200, to: 200 } },
    });
  },
  death: () => {
    pitched("sawtooth", 320, 50, 0.6, 0.22);
    Audio.tone({
      wave: "noise",
      release: 0.5,
      gain: 0.12,
      filter: { type: "lowpass", freq: { from: 900, to: 120 } },
    });
  },
  unlock: () => arp("triangle", [659, 831, 988, 1319], 0.28, 0.16, 0.07),
  win: () => arp("triangle", [523, 659, 784, 1047], 0.32, 0.18, 0.1),
};

// -- Level data (the numeric JSON + entity lists) -----------------------------
interface LevelData {
  tiles: number[][];
  coins: [number, number][];
  enemies: [number, number][];
  goal: [number, number];
}
interface Coin {
  x: number;
  y: number;
  got: boolean;
  pop: number;
}
// Enemies patrol at a fixed height (no gravity) and turn at walls — the simple,
// robust classic. A Rect so `rectsOverlap`/`Draw.sprite` take it directly.
interface Enemy {
  x: number;
  y: number;
  w: number;
  h: number;
  dir: number; // -1 / +1 patrol direction
  dead: boolean;
}
interface Player extends MoverBody {
  facing: number;
  wall: number; // side of a wall we're pressing: -1 left, +1 right, 0 none
  invuln: number; // seconds of post-hit i-frames
  hurt: number; // seconds left playing the hit clip
}

// -- Load-time state ----------------------------------------------------------
let ready = false;
let failed = "";
let loadFrac = 0;
let data: LevelData;
let level: Level;
let terrainImg: HTMLImageElement;
let skyLayer: HTMLCanvasElement;
let terrainLayer: HTMLCanvasElement;
let playerAnim: StateCursor<"idle" | "run" | "jump" | "fall" | "hit">;
let enemyAnim: SheetCursor;
let fruitAnim: SheetCursor;
let goalAnim: SheetCursor;

// -- Play state ---------------------------------------------------------------
let player: Player;
let enemies: Enemy[] = [];
let coins: Coin[] = [];
let goal = { x: 0, y: 0 };
let lives = 3;
let mode: "play" | "won" | "gameover" = "play";
const fx = Particles.create();

const spawn = { x: 96, y: 10 * TILE }; // player feet-center start (world px)

// A draw rect sized `w×h` whose bottom-center sits at the body's feet-center —
// Draw.sprite anchors there, so the art overhangs the smaller collision box.
function artBox(b: { x: number; y: number; w: number; h: number }, w: number, h: number) {
  return { x: b.x + b.w / 2 - w / 2, y: b.y + b.h - h, w, h };
}

// Parallax backdrop: a sun and clouds at fixed WORLD positions, drawn through
// `Camera.layer` at a fraction of the camera speed. The sun barely moves (very
// far); the clouds drift a little — so the sky is a receding background, not a
// panel stuck to the viewport.
const SUN = { x: 220, y: 66, r: 26 };
const CLOUDS: [number, number, number][] = [
  [120, 60, 1.1],
  [340, 40, 0.8],
  [520, 92, 1.25],
  [700, 52, 0.95],
  [880, 78, 1.1],
  [1000, 46, 0.8],
];
function drawParallaxSky() {
  const g = Draw.ctx;
  // Sun — nearly fixed (a distant light), but with a hint of parallax.
  Camera.layer(0.12, () => {
    g.fillStyle = "rgba(255,244,184,.85)";
    g.beginPath();
    g.arc(SUN.x, SUN.y, SUN.r, 0, Math.PI * 2);
    g.fill();
  });
  // Clouds — drift faster than the sun, slower than the world.
  Camera.layer(0.35, () => {
    g.fillStyle = "rgba(255,255,255,.5)";
    for (const [cx, cy, s] of CLOUDS) {
      for (const [dx, dy, r] of [
        [0, 0, 18],
        [17, 5, 13],
        [-17, 5, 12],
        [7, -7, 12],
      ]) {
        g.beginPath();
        g.ellipse(cx + dx * s, cy + dy * s, r * s, r * s * 0.68, 0, 0, Math.PI * 2);
        g.fill();
      }
    }
  });
}

// ---------------------------------------------------------------------------
// Static art: one native-resolution sky blit + one autotiled terrain blit,
// both cached (independent of tile count / frame). The terrain reads a 3×3
// grass block of 16px sub-tiles at (96,0) in the atlas — grass lip on top,
// dirt sides, corners where edges meet — picking each sub-tile's variant from
// the cell's open neighbours (queried through `level.at`).
// ---------------------------------------------------------------------------
function makeStaticLayers() {
  // Just the gradient — a flat, uniform base that fills the screen. The sun and
  // clouds are drawn separately on a slow PARALLAX layer (see draw()), so the
  // sky reads as a receding backdrop instead of a panel welded to the viewport.
  skyLayer = Sprites.getLayer("pixel-adventure:sky", GAME_W, GAME_H, 1, (g) => {
    g.imageSmoothingEnabled = false;
    const sky = g.createLinearGradient(0, 0, 0, GAME_H);
    sky.addColorStop(0, "#3aa6c4");
    sky.addColorStop(1, "#245b9b");
    g.fillStyle = sky;
    g.fillRect(0, 0, GAME_W, GAME_H);
  });

  const SUB = 16;
  const BX = 96;
  const BY = 0;
  const N = TILE / SUB; // 3 sub-tiles per cell
  const cols = data.tiles[0].length;
  const rows = data.tiles.length;
  const solidAt = (cx: number, cy: number) => level.at(cx, cy) === "#";
  terrainLayer = Sprites.getLayer("pixel-adventure:terrain", level.rect.w, level.rect.h, 1, (g) => {
    g.imageSmoothingEnabled = false;
    for (let y = 0; y < rows; y++)
      for (let x = 0; x < cols; x++)
        if (solidAt(x, y)) {
          const px = x * TILE;
          const py = y * TILE;
          const openU = !solidAt(x, y - 1);
          const openD = !solidAt(x, y + 1);
          const openL = !solidAt(x - 1, y);
          const openR = !solidAt(x + 1, y);
          g.fillStyle = "rgba(19,45,65,.28)";
          g.fillRect(px + 4, py + 5, TILE, TILE);
          for (let sr = 0; sr < N; sr++)
            for (let sc = 0; sc < N; sc++) {
              const eU = openU && sr === 0;
              const eD = openD && sr === N - 1;
              const eL = openL && sc === 0;
              const eR = openR && sc === N - 1;
              const srcX = BX + (eL ? 0 : eR ? 2 : 1) * SUB;
              const srcY = BY + (eU ? 0 : eD ? 2 : 1) * SUB;
              g.drawImage(terrainImg, srcX, srcY, SUB, SUB, px + sc * SUB, py + sr * SUB, SUB, SUB);
            }
        }
  });
}

// ---------------------------------------------------------------------------
// Load: images + JSON by extension, then build the level, animations and world.
// ---------------------------------------------------------------------------
const asset = (p: string) => new URL(`./assets/${p}`, import.meta.url).href;

Assets.load(
  {
    level: new URL("./level.json", import.meta.url).href,
    terrain: asset("terrain.png"),
    playerIdle: asset("player-idle.png"),
    playerRun: asset("player-run.png"),
    playerJump: asset("player-jump.png"),
    playerFall: asset("player-fall.png"),
    playerHit: asset("player-hit.png"),
    enemy: asset("radish-run.png"),
    fruit: asset("bananas.png"),
    goal: asset("goal.png"),
  },
  (done, total) => (loadFrac = done / total),
)
  .then((A) => {
    // The loader types a bare URL string as an image; the .json extension makes
    // it parsed JSON at runtime, so narrow through `unknown`.
    data = A.level as unknown as LevelData;
    terrainImg = A.terrain;

    // Numeric grid → ASCII + legend, the source-of-truth level. `#` is solid;
    // collision and terrain rendering both read it.
    const ascii = data.tiles
      .map((row) => row.map((t) => (t === 1 ? "#" : ".")).join(""))
      .join("\n");
    level = Tiles.grid(ascii, { size: TILE, legend: { "#": { solid: true } } });

    // The player: one image PER state. `frames` comes from each strip's width,
    // so no hand-counted frame numbers — swap in another Pixel Frog character
    // and it just works.
    const strip = (img: HTMLImageElement, fps?: number) => ({
      image: img,
      frames: Math.round(img.width / FW),
      fps,
    });
    playerAnim = Anim.states({
      idle: strip(A.playerIdle, 8),
      run: strip(A.playerRun, 12),
      jump: strip(A.playerJump),
      fall: strip(A.playerFall),
      hit: strip(A.playerHit, 14),
    }).play("idle");

    // Enemy / fruit / goal are single strips — one looping Anim.sheet cursor
    // each, shared across every instance (they animate in lockstep).
    const loop = (img: HTMLImageElement, fw: number, fh: number, fps: number) =>
      Anim.sheet(img, {
        frame: { w: fw, h: fh },
        states: { loop: { row: 0, frames: Math.round(img.width / fw), fps } },
      }).play("loop");
    enemyAnim = loop(A.enemy, 30, 38, 9);
    fruitAnim = loop(A.fruit, 32, 32, 10);
    goalAnim = loop(A.goal, 64, 64, 5);

    goal = { x: data.goal[0] * TILE + TILE / 2, y: data.goal[1] * TILE + TILE / 2 };
    makeStaticLayers();
    resetRun(); // builds the player, then points the default camera at it
    ready = true;
  })
  .catch((error) => (failed = String(error)));

// ---------------------------------------------------------------------------
// Run / respawn helpers
// ---------------------------------------------------------------------------
function makePlayer(): Player {
  return {
    x: spawn.x - 13,
    y: spawn.y - 36,
    w: 26,
    h: 36,
    vel: { x: 0, y: 0 },
    grounded: false,
    facing: 1,
    wall: 0,
    invuln: 1.25,
    hurt: 0,
  };
}

function resetRun() {
  mode = "play";
  lives = 3;
  player = makePlayer();
  coins = data.coins.map(([cx, cy]) => ({
    x: cx * TILE + TILE / 2,
    y: cy * TILE + TILE / 2,
    got: false,
    pop: 0,
  }));
  enemies = data.enemies.map(([cx, cy], i) => ({
    x: cx * TILE + 1,
    y: cy * TILE - 35, // feet rest at the top of row cy
    w: 28,
    h: 35,
    dir: i % 2 ? -1 : 1,
    dead: false,
  }));
  // Tall vertical deadzone: the camera tracks horizontally but holds steady
  // through jumps, so the ground (and the fixed sky/HUD over it) don't jerk.
  Camera.follow(player, { world: level.rect, deadzone: { w: 60, h: 170 }, damping: 0.12 });
  Camera.snap();
}

function respawn() {
  player.x = spawn.x - player.w / 2;
  player.y = spawn.y - player.h;
  player.vel.x = 0;
  player.vel.y = 0;
  player.grounded = false;
  player.invuln = 1.5;
}

function hurt() {
  if (player.invuln > 0) return;
  lives--;
  player.invuln = 1.5;
  player.hurt = 0.35;
  SFX.hurt();
  fx.burst({
    at: { x: player.x + player.w / 2, y: player.y + player.h / 2 },
    count: 20,
    color: ["#ff6b6b", "#ffe066"],
    speed: [1, 3],
    life: [280, 700],
    gravity: 0.08,
  });
  UI.floatText("OUCH!", player.x + player.w / 2, player.y - 8, { color: "#ff6b6b" });
  if (lives === 0) {
    mode = "gameover";
    SFX.death();
  } else respawn();
}

// ---------------------------------------------------------------------------
// Update
// ---------------------------------------------------------------------------
Loop.run({
  update() {
    if (!ready) return;
    if (Keys.pressed("KeyR")) {
      resetRun();
      return;
    }
    if (mode !== "play") return;

    const dt = Loop.step / 1000;
    player.invuln = Math.max(0, player.invuln - dt);
    player.hurt = Math.max(0, player.hurt - dt);

    // -- Horizontal --
    const run = input.axis("left", "right");
    if (run !== 0) {
      player.vel.x = Mathf.approach(player.vel.x, run * MOVE, ACCEL);
      player.facing = Math.sign(run);
    } else {
      player.vel.x = Mathf.approach(player.vel.x, 0, FRICTION);
    }

    // -- Jump / wall jump --
    const pressedJump = input.jump.pressed;
    const intoWall =
      (player.wall === -1 && input.left.down) || (player.wall === 1 && input.right.down);
    const onWall = !player.grounded && intoWall;
    if (jumpGate.try(pressedJump, player.grounded)) {
      player.vel.y = JUMP;
      player.grounded = false;
      SFX.jump();
    } else if (pressedJump && onWall) {
      // Composed from moveAndSlide's wall contact + our chosen impulse.
      player.vel.y = WALL_JUMP_Y;
      player.vel.x = -player.wall * WALL_JUMP_X;
      player.facing = -player.wall;
      jumpGate.buffer.consume(); // don't also fire a ground jump on landing
      SFX.jump();
    }
    if (input.jump.released && player.vel.y < 0) player.vel.y *= JUMP_CUTOFF;

    // -- Gravity + wall slide --
    player.vel.y = Math.min(MAX_FALL, player.vel.y + GRAVITY);
    if (onWall && player.vel.y > WALL_SLIDE) player.vel.y = WALL_SLIDE;

    // -- Move against the tiles; read the contacts back --
    const hit = Collision.moveAndSlide(player, level);
    player.wall = !player.grounded && hit.left ? -1 : !player.grounded && hit.right ? 1 : 0;

    // -- Animation state, derived from live physics (drives the cursor) --
    playerAnim.set(
      player.hurt > 0
        ? "hit"
        : !player.grounded
          ? player.vel.y < 0
            ? "jump"
            : "fall"
          : Math.abs(player.vel.x) > 0.3
            ? "run"
            : "idle",
    );

    // -- Enemies: fixed-height patrol; turn at a wall or a ledge --
    for (const e of enemies) {
      if (e.dead) continue;
      const nextX = e.x + e.dir * ENEMY_SPEED;
      const lead = e.dir > 0 ? nextX + e.w : nextX; // leading vertical edge
      const wallAhead = level.solidAt(lead, e.y + e.h / 2);
      const groundAhead = level.solidAt(lead, e.y + e.h + 2);
      if (wallAhead || !groundAhead) e.dir = -e.dir;
      else e.x = nextX;
      if (Collision.rectsOverlap(player, e)) {
        if (player.vel.y > 1 && player.y + player.h / 2 < e.y) {
          e.dead = true;
          player.vel.y = STOMP_BOUNCE;
          SFX.stomp();
          Camera.shake(3.5, 190);
          UI.floatText("+100", e.x + e.w / 2, e.y - 8, { color: "#ffe066" });
          fx.burst({
            at: { x: e.x + e.w / 2, y: e.y },
            count: 18,
            color: ["#ff9f43", "#ffe066"],
            speed: [1, 3],
            life: [260, 620],
            gravity: 0.05,
          });
        } else hurt();
      }
    }

    // -- Fruit pickups --
    for (const c of coins) {
      if (c.got) {
        c.pop += dt;
        continue;
      }
      if (!Collision.circleRect(c.x, c.y, 24, player)) continue;
      c.got = true;
      c.pop = 0;
      SFX.coin();
      UI.floatText("FRUIT!", c.x, c.y - 20, { color: "#fff3a3" });
      fx.burst({
        at: c,
        count: 22,
        color: ["#fff", "#fff3a3", "#ffe066", "#ffb347"],
        size: [1, 4],
        speed: [1, 3.5],
        life: [300, 680],
        gravity: 0.03,
      });
      if (coins.every((k) => k.got)) {
        SFX.unlock();
        UI.floatText("GOAL UNLOCKED!", player.x + player.w / 2, player.y - 20, {
          color: "#64f0c8",
        });
      }
    }

    // -- Fall out of the world --
    if (player.y > level.rect.h + 70) hurt();

    // -- Reach the unlocked goal --
    if (coins.every((c) => c.got) && Collision.circleRect(goal.x, goal.y, 30, player)) {
      mode = "won";
      SFX.win();
    }
  },

  draw() {
    Draw.ctx.imageSmoothingEnabled = false;
    if (!ready) {
      UI.group(
        { x: GAME_W / 2 - 100, y: GAME_H / 2 - 32, w: 200, h: 60, title: "PIXEL ADVENTURE" },
        () => {
          UI.text(failed || "Loading Pixel Frog atlases…", {
            h: 20,
            size: 9,
            align: "center",
            color: "#fff",
          });
        },
      );
      UI.bar(GAME_W / 2 - 78, GAME_H / 2 + 8, 156, 8, loadFrac, {
        fill: "#ffe066",
        bg: "#263653",
      });
      return;
    }

    // Fixed gradient base, then the sun/clouds on slow parallax layers, then
    // the world through the (full-speed) camera.
    Draw.ctx.drawImage(skyLayer, 0, 0);
    drawParallaxSky();
    Camera.render(() => {
      Draw.ctx.imageSmoothingEnabled = false;
      Draw.ctx.drawImage(terrainLayer, 0, 0);

      const unlocked = coins.every((c) => c.got);
      // Goal is a world point; center a 58×58 frame on it (Draw.sprite anchors
      // the frame's bottom-center at the rect's bottom-center).
      Draw.sprite(goalAnim, { x: goal.x - 29, y: goal.y - 29, w: 58, h: 58 });
      if (!unlocked) Draw.rect(goal.x - 20, goal.y - 30, 40, 50, "rgba(10,22,44,.6)");

      for (const c of coins) {
        if (!c.got) Draw.sprite(fruitAnim, { x: c.x - 16, y: c.y - 16, w: 32, h: 32 });
        else if (c.pop < 0.5) {
          const t = c.pop / 0.5;
          Draw.opacity(1 - t, () =>
            Draw.sprite(fruitAnim, { x: c.x - 16, y: c.y - 16 - t * 24, w: 32, h: 32 }),
          );
        }
      }
      // Radish art faces left, so flip when moving right.
      for (const e of enemies)
        if (!e.dead) Draw.sprite(enemyAnim, artBox(e, 42, 53), { flipX: e.dir > 0 });
      // Blink during i-frames.
      if (player.invuln <= 0 || Math.floor(player.invuln * 12) % 2 === 0)
        Draw.sprite(playerAnim, artBox(player, 48, 48), { flipX: player.facing < 0 });

      Draw.particles(fx);
      UI.drawFloatText(); // world-space pops
    });

    // HUD — a title-less UI.group (a panel without the chunky 32px title band),
    // small in LOGICAL px; the letterbox scales it up to the window.
    UI.group({ x: 8, y: 8, w: 158, h: 40, gap: 2, pad: 6 }, () => {
      UI.text("SUNNY RUN", { h: 12, size: 8, color: "#4ecdc4" });
      UI.text(
        `FRUIT ${coins.filter((c) => c.got).length}/${coins.length}   LIVES ${"◆".repeat(lives)}`,
        { h: 12, size: 9, color: "#fff" },
      );
    });
    UI.text(coins.every((c) => c.got) ? "GOAL UNLOCKED!" : "Find all fruit", {
      x: 8,
      y: GAME_H - 15,
      size: 9,
      color: "#e9f8ff",
    });

    if (mode === "won" || mode === "gameover") {
      const won = mode === "won";
      Draw.rect(0, 0, GAME_W, GAME_H, "rgba(7,15,30,.78)");
      UI.group(
        {
          x: GAME_W / 2 - 110,
          y: GAME_H / 2 - 42,
          w: 220,
          h: 84,
          title: won ? "ADVENTURE COMPLETE" : "TRY AGAIN",
          border: won ? "#64f0c8" : "#ff6b6b",
        },
        () => {
          UI.text(won ? "YOU FOUND THE WAY!" : "OUT OF LIVES", {
            h: 32,
            size: 13,
            align: "center",
            color: won ? "#64f0c8" : "#ff6b6b",
          });
          UI.text("Press R to restart", { h: 20, size: 9, align: "center", color: "#fff" });
        },
      );
    }

    // On-screen touch controls, drawn in true window corners (outside the
    // letterbox). Auto-hidden on desktop.
    OnscreenInput.drawControls(pad);
  },
});
