// Ascent — a Celeste-style precision platformer built from Minimotor
// primitives, dressed in the "Lore" pixel-art set (CC assets under
// ./assets). Three hand-built rooms, Madeline-style movement:
//
//   Assets     — parallel image load, then one composed sprite sheet per state.
//   Anim / Fsm — Idle/Run/Jump/Fall/Wall/Dash clips (real art) driven by a
//                state machine via the anim bridge (1:1 state→clip).
//   Timers     — jumpGate (coyote + jump buffering) and window latches for the
//                dash refill and wall-jump coyote grace.
//   Particles  — dust puffs, dash bursts; the Lore "Death" burst plays on death.
//   Camera     — screen shake on dash & death (no shake on plain landings).
//   Audio      — jump / dash / death / orb blips.  Storage — best (fewest deaths).
//
// Controls: ←/→ or A/D move · C/Z/Space/↑ jump · X/Shift/K dash (8-directional)
//           R restart room. Dash refills on the ground or a floating orb; the
//           orb goes dim while spent.

import { Minimotor } from "minimotor";

const { Assets, Fsm, Anim, Timers, Particles, Camera, Audio, Storage, Mathf, Draw, Loop, Keys, UI } =
  Minimotor;

let vp = Minimotor.Stage.init("game", { plugins: [Minimotor.Perf.plugin()] });
Minimotor.Stage.onResize((next) => (vp = next));

// ---------------------------------------------------------------------------
// World grid — 16px cells (the 8px tiles are drawn at 2×).
// ---------------------------------------------------------------------------
const CELL = 16;
const TILE = 8; // native art tile size
const COLS = 40;
const ROWS = 23;
const WORLD_W = COLS * CELL;
const WORLD_H = ROWS * CELL;

// ---------------------------------------------------------------------------
// Level definitions (structured, so reachability is easy to reason about).
//   plats  : [col, row, width, height?]  solid blocks (height defaults to 1)
//   spikes : [col, row, len, dir]        dir "up" (floor) or "down" (ceiling)
//   orbs   : [col, row]                  dash-refill orbs (cell centre)
//   spawn  : [col, row]                  player stands with feet at row's base
//   exit   : [col, row]                  goal cell
//   goal   : "sign" | "house"
// A solid border is added around every room automatically.
// ---------------------------------------------------------------------------
const LEVELS = [
  {
    name: "Foothills",
    sky: ["#26314f", "#3b4a72", "#6f83a8"],
    goal: "sign",
    spawn: [3, 20],
    exit: [34, 5],
    plats: [
      [1, 21, 38], // ground
      [5, 18, 4],
      [11, 15, 4],
      [17, 17, 4],
      [22, 14, 4],
      [27, 11, 5],
      [32, 8, 5],
      [30, 6, 8], // exit ledge
    ],
    spikes: [[13, 20, 5, "up"]],
    orbs: [[19, 12]],
    props: [
      ["tree", 2, 21],
      ["rock", 24, 21],
    ],
  },
  {
    name: "The Crevice",
    sky: ["#1b2436", "#2c3d4a", "#5a7d6a"],
    goal: "sign",
    spawn: [3, 20],
    exit: [36, 5],
    plats: [
      [1, 21, 10], // start ground
      [1, 1, 2, 21], // left wall pillar (chimney start)
      [7, 17, 4],
      [13, 21, 6], // mid floor over a spike pit
      [13, 14, 4],
      [19, 11, 3],
      [24, 21, 16], // right ground
      [24, 15, 2, 6], // right chimney wall
      [30, 15, 2, 6], // right chimney wall (wall-jump up)
      [24, 8, 8], // top ledge
      [33, 6, 7], // exit ledge
    ],
    spikes: [
      [11, 22, 2, "up"], // pit under the mid gap (bottom border area)
      [17, 20, 6, "up"],
      [26, 20, 4, "up"],
    ],
    orbs: [
      [10, 14],
      [21, 18],
    ],
    props: [["rock", 5, 21]],
  },
  {
    name: "Summit",
    sky: ["#241640", "#43306e", "#c06a9a"],
    goal: "house",
    spawn: [3, 20],
    exit: [34, 4],
    plats: [
      [1, 21, 12],
      [15, 21, 8],
      [26, 21, 13],
      [6, 17, 4],
      [12, 14, 3],
      [17, 12, 3],
      [10, 10, 3],
      [4, 8, 4],
      [22, 15, 4],
      [28, 13, 2, 8], // right chimney
      [34, 13, 2, 8],
      [28, 7, 8], // upper ledge before house
      [31, 5, 8], // house ledge
    ],
    spikes: [
      [13, 20, 2, "up"],
      [23, 20, 3, "up"],
    ],
    orbs: [
      [9, 12],
      [20, 13],
      [26, 17],
      [31, 10],
    ],
    props: [
      ["tree", 1, 21],
      ["rock", 24, 21],
    ],
  },
];

// ---------------------------------------------------------------------------
// Build a bordered tile grid from a level definition.
// ---------------------------------------------------------------------------
function buildLevel(def) {
  const grid = Array.from({ length: ROWS }, () => new Array(COLS).fill(" "));
  const set = (c, r, ch) => {
    if (c >= 0 && c < COLS && r >= 0 && r < ROWS) grid[r][c] = ch;
  };
  // Border.
  for (let c = 0; c < COLS; c++) {
    set(c, 0, "#");
    set(c, ROWS - 1, "#");
  }
  for (let r = 0; r < ROWS; r++) {
    set(0, r, "#");
    set(COLS - 1, r, "#");
  }
  // Platforms.
  for (const [c, r, w, h = 1] of def.plats)
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) set(c + x, r + y, "#");
  // Spikes (overwrite; they sit in an otherwise-open cell).
  for (const [c, r, len, dir] of def.spikes)
    for (let x = 0; x < len; x++) set(c + x, r, dir === "down" ? "V" : "^");

  const orbs = def.orbs.map(([c, r]) => ({
    x: c * CELL + CELL / 2,
    y: r * CELL + CELL / 2,
    cd: 0,
  }));
  const spawn = { x: def.spawn[0] * CELL + (CELL - PW) / 2, y: (def.spawn[1] + 1) * CELL - PH };
  const exit = { x: def.exit[0] * CELL, y: def.exit[1] * CELL };
  return { grid, orbs, spawn, exit, goal: def.goal, sky: def.sky, name: def.name, props: def.props };
}

function tileAt(grid, c, r) {
  if (c < 0 || c >= COLS || r < 0 || r >= ROWS) return "#";
  return grid[r][c];
}
const isSolid = (grid, c, r) => tileAt(grid, c, r) === "#";

// Deadly-tile overlap for a rect (spikes only kill in their business half).
function spikeHit(grid, x, y, w, h) {
  const c0 = Math.floor(x / CELL);
  const c1 = Math.floor((x + w - 1) / CELL);
  const r0 = Math.floor(y / CELL);
  const r1 = Math.floor((y + h - 1) / CELL);
  for (let r = r0; r <= r1; r++) {
    for (let c = c0; c <= c1; c++) {
      const t = tileAt(grid, c, r);
      if (t === "^" && y + h > r * CELL + CELL * 0.5) return true;
      if (t === "V" && y < r * CELL + CELL * 0.5) return true;
    }
  }
  return false;
}

// ---------------------------------------------------------------------------
// Player
// ---------------------------------------------------------------------------
const PW = 11;
const PH = 20;

const GRAVITY = 0.55;
const MAX_FALL = 8.5;
const RUN_MAX = 3.4;
const RUN_ACCEL = 0.65;
const AIR_ACCEL = 0.45;
const GROUND_FRICTION = 0.5;
const AIR_FRICTION = 0.75;
const JUMP_V = -9.2;
const WALL_SLIDE_MAX = 1.7;
const WALL_JUMP_VX = 5.6;
const WALL_JUMP_VY = -8.8;
const DASH_SPEED = 8.4;
const DASH_END_SPEED = 3.6;
const DASH_FRAMES = 11;
const DASH_FREEZE = 3;
const INV_SQRT2 = 0.7071;

const player = {
  x: 0,
  y: 0,
  vx: 0,
  vy: 0,
  facing: 1,
  onGround: false,
  wallDir: 0,
  hasDash: true,
  dashTime: 0,
  dashDx: 0,
  dashDy: 0,
  freeze: 0,
  wallLock: 0,
  dead: false,
  deadTimer: 0,
};

const jumpGate = Timers.jumpGate({ coyoteMs: 100, bufferMs: 130 });
const wallCoyote = Timers.window(90);
let wallCoyoteDir = 0;

// ---------------------------------------------------------------------------
// Assets & animation (built after load)
// ---------------------------------------------------------------------------
const url = (name) => new URL(`./assets/${name}.png`, import.meta.url).href;
const FRAME = 32; // player frame size
const FEET_Y = 23; // frame-y of the character's feet (content ends ~here)

let anim; // Anim.states for the player
let sm; // player Fsm
let deathAnim = null; // one-shot Lore death burst
let orbAnim; // shared animated dash orb
const tex = {}; // decoded tile / prop images by key

// Fraction (0..1) of image height at which opaque pixels stop — used to seat
// a sprite's real base on a surface, ignoring transparent bottom padding.
function opaqueBottomFrac(img) {
  const c = document.createElement("canvas");
  c.width = img.width;
  c.height = img.height;
  const g = c.getContext("2d");
  g.drawImage(img, 0, 0);
  const data = g.getImageData(0, 0, img.width, img.height).data;
  for (let y = img.height - 1; y >= 0; y--)
    for (let x = 0; x < img.width; x++)
      if (data[(y * img.width + x) * 4 + 3] > 8) return (y + 1) / img.height;
  return 1;
}

// Compose N same-size frame images side by side into one sheet canvas.
function composeSheet(images) {
  const cv = document.createElement("canvas");
  cv.width = FRAME * images.length;
  cv.height = FRAME;
  const g = cv.getContext("2d");
  g.imageSmoothingEnabled = false;
  images.forEach((img, i) => g.drawImage(img, i * FRAME, 0));
  return cv;
}

const TILE_KEYS = [
  "grassTL", "grassTM", "grassTR",
  "dirtML", "dirtMM", "dirtMR",
  "dirtBL", "dirtBM", "dirtBR",
  "spikeUp", "spikeDown", "bg", "rays",
  "tree", "house", "rock", "sign",
];

function manifest() {
  const m = {};
  const add = (n) => (m[n] = url(n));
  for (let i = 0; i < 4; i++) add(`idle${i}`);
  for (let i = 0; i < 4; i++) add(`run${i}`);
  for (let i = 0; i < 3; i++) add(`jump${i}`);
  for (let i = 0; i < 4; i++) add(`death${i}`);
  for (let i = 0; i < 4; i++) add(`orb${i}`);
  for (let i = 0; i < 4; i++) add(`climb${i}`);
  for (const k of TILE_KEYS) add(k);
  return m;
}

function buildAnimations() {
  const img = (n) => Assets.image(n);
  const idleSheet = composeSheet([img("idle0"), img("idle1"), img("idle2"), img("idle3")]);
  const runSheet = composeSheet([img("run0"), img("run1"), img("run2"), img("run3")]);
  const jumpSheet = composeSheet([img("jump0"), img("jump1"), img("jump2")]);
  const climbSheet = composeSheet([img("climb0"), img("climb1"), img("climb2"), img("climb3")]);
  // `cols` must equal each sheet's real frame count (single row) so the default
  // frame list and the source-rect math line up.
  const s = (sheet, cols, extra = {}) => Anim.sheet(sheet, { fw: FRAME, fh: FRAME, cols, ...extra });

  anim = Anim.states(
    {
      idle: s(idleSheet, 4, { fps: 5 }),
      run: s(runSheet, 4, { fps: 13 }),
      jump: s(jumpSheet, 3, { fps: 10 }),
      fall: s(jumpSheet, 3, { fps: 1, frames: [2] }),
      wall: s(climbSheet, 4, { fps: 8 }),
      dash: s(jumpSheet, 3, { fps: 1, frames: [0] }),
    },
    "idle",
  );

  // Cache decoded tile/prop images (the ECS/Anim path wants canvases scaled;
  // here we draw them directly, scaling in draw calls).
  for (const k of TILE_KEYS) tex[k] = img(k);

  // Store the death sheet + orb sheet for one-shot / looped playback.
  tex._deathSheet = composeSheet([img("death0"), img("death1"), img("death2"), img("death3")]);
  const orbSheet = composeSheet([img("orb0"), img("orb1"), img("orb2"), img("orb3")]);
  tex._orbSheet = orbSheet;
  orbAnim = Anim.sheet(orbSheet, { fw: FRAME, fh: FRAME, cols: 4, fps: 8 });

  // Fraction of image height where opaque content ends, so the goal props seat
  // on the ledge regardless of transparent padding at the bottom of the sprite.
  tex._signBase = opaqueBottomFrac(img("sign"));
  tex._houseBase = opaqueBottomFrac(img("house"));

  sm = makeFsm();
}

function makeFsm() {
  return Fsm.create(
    {
      idle: {
        update: () =>
          player.dashTime > 0 ? "dash"
          : !player.onGround ? (player.vy < 0 ? "jump" : "fall")
          : Math.abs(player.vx) > 0.4 ? "run"
          : null,
      },
      run: {
        update: () =>
          player.dashTime > 0 ? "dash"
          : !player.onGround ? (player.vy < 0 ? "jump" : "fall")
          : Math.abs(player.vx) <= 0.4 ? "idle"
          : null,
      },
      jump: {
        update: () =>
          player.dashTime > 0 ? "dash"
          : player.onGround ? "idle"
          : player.wallDir !== 0 && player.vy > 0 ? "wall"
          : player.vy >= 0 ? "fall"
          : null,
      },
      fall: {
        update: () =>
          player.dashTime > 0 ? "dash"
          : player.onGround ? "idle"
          : player.wallDir !== 0 ? "wall"
          : null,
      },
      wall: {
        update: () =>
          player.dashTime > 0 ? "dash"
          : player.onGround ? "idle"
          : player.wallDir === 0 ? "fall"
          : null,
      },
      dash: {
        update: () =>
          player.dashTime > 0 ? null
          : player.onGround ? "idle"
          : player.wallDir !== 0 ? "wall"
          : "fall",
      },
    },
    "idle",
    { anim },
  );
}

// ---------------------------------------------------------------------------
// Level / progression state
// ---------------------------------------------------------------------------
let levelIndex = 0;
let level;
let deaths = 0;
let bestDeaths = Storage.load("ascent_best", null);
let won = false;
let ready = false;
let fade = 1;

function loadLevel(i) {
  level = buildLevel(LEVELS[i]);
  respawn(true);
}

function respawn(hard) {
  player.x = level.spawn.x;
  player.y = level.spawn.y;
  player.vx = player.vy = 0;
  player.facing = 1;
  player.hasDash = true;
  player.dashTime = player.freeze = player.wallLock = 0;
  player.dead = false;
  player.deadTimer = 0;
  deathAnim = null;
  if (hard && sm) sm.go("idle");
}

function die() {
  if (player.dead) return;
  player.dead = true;
  player.deadTimer = 40;
  deaths++;
  Camera.shake(6, 300);
  Audio.Sfx.blip(150, 0.28, 0.3);
  Audio.Sfx.blip(90, 0.4, 0.25);
  deathAnim = Anim.sheet(tex._deathSheet, {
    fw: FRAME, fh: FRAME, cols: 4, fps: 16, loop: false,
  });
  Particles.burst(player.x + PW / 2, player.y + PH / 2, {
    count: 22,
    speed: [80, 220],
    size: [2, 4],
    life: [400, 800],
    colors: ["#ffffff", "#c9d0e0", "#7d8598"],
  });
}

function nextLevel() {
  if (levelIndex + 1 >= LEVELS.length) {
    won = true;
    if (bestDeaths === null || deaths < bestDeaths) {
      bestDeaths = deaths;
      Storage.save("ascent_best", bestDeaths);
    }
    return;
  }
  levelIndex++;
  loadLevel(levelIndex);
  fade = 1;
  Audio.Sfx.coin();
}

function restartGame() {
  levelIndex = 0;
  deaths = 0;
  won = false;
  loadLevel(0);
  fade = 1;
}

// ---------------------------------------------------------------------------
// Collision (axis-separated AABB vs. tile grid)
// ---------------------------------------------------------------------------
function moveX(dx) {
  player.x += dx;
  const g = level.grid;
  const r0 = Math.floor(player.y / CELL);
  const r1 = Math.floor((player.y + PH - 1) / CELL);
  if (dx > 0) {
    const c = Math.floor((player.x + PW - 1) / CELL);
    for (let r = r0; r <= r1; r++)
      if (isSolid(g, c, r)) {
        player.x = c * CELL - PW;
        player.vx = 0;
        return;
      }
  } else if (dx < 0) {
    const c = Math.floor(player.x / CELL);
    for (let r = r0; r <= r1; r++)
      if (isSolid(g, c, r)) {
        player.x = (c + 1) * CELL;
        player.vx = 0;
        return;
      }
  }
}

function moveY(dy) {
  player.y += dy;
  const g = level.grid;
  const c0 = Math.floor(player.x / CELL);
  const c1 = Math.floor((player.x + PW - 1) / CELL);
  if (dy > 0) {
    const r = Math.floor((player.y + PH - 1) / CELL);
    for (let c = c0; c <= c1; c++)
      if (isSolid(g, c, r)) {
        player.y = r * CELL - PH;
        player.vy = 0;
        player.onGround = true;
        return;
      }
  } else if (dy < 0) {
    const r = Math.floor(player.y / CELL);
    for (let c = c0; c <= c1; c++)
      if (isSolid(g, c, r)) {
        player.y = (r + 1) * CELL;
        player.vy = 0;
        return;
      }
  }
}

// Stable "am I standing on ground?" probe (1px below the feet).
function groundBelow() {
  const g = level.grid;
  const c0 = Math.floor((player.x + 1) / CELL);
  const c1 = Math.floor((player.x + PW - 2) / CELL);
  const r = Math.floor((player.y + PH + 1) / CELL);
  for (let c = c0; c <= c1; c++) if (isSolid(g, c, r)) return true;
  return false;
}

function wallOn(dir) {
  const g = level.grid;
  const x = dir > 0 ? player.x + PW : player.x - 1;
  const r0 = Math.floor((player.y + 2) / CELL);
  const r1 = Math.floor((player.y + PH - 3) / CELL);
  const c = Math.floor(x / CELL);
  for (let r = r0; r <= r1; r++) if (isSolid(g, c, r)) return true;
  return false;
}

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------
const key = {
  left: () => Keys.down("ArrowLeft") || Keys.down("KeyA"),
  right: () => Keys.down("ArrowRight") || Keys.down("KeyD"),
  up: () => Keys.down("ArrowUp") || Keys.down("KeyW"),
  down: () => Keys.down("ArrowDown") || Keys.down("KeyS"),
  jumpPress: () =>
    Keys.pressed("KeyC") || Keys.pressed("KeyZ") || Keys.pressed("Space") || Keys.pressed("ArrowUp"),
  jumpHeld: () => Keys.down("KeyC") || Keys.down("KeyZ") || Keys.down("Space") || Keys.down("ArrowUp"),
  dashPress: () => Keys.pressed("KeyX") || Keys.pressed("ShiftLeft") || Keys.pressed("KeyK"),
};

// ---------------------------------------------------------------------------
// Load, then run
// ---------------------------------------------------------------------------
Assets.load(manifest()).then(() => {
  buildAnimations();
  loadLevel(0);
  ready = true;
});

Loop.run({
  update() {
    if (!ready) return;
    const step = Loop.step;
    if (orbAnim) orbAnim.update(step);
    level.orbs.forEach((o) => (o.cd = Math.max(0, o.cd - 1)));

    if (won) {
      if (Keys.pressed("KeyR")) restartGame();
      return;
    }
    if (Keys.pressed("KeyR")) respawn(true);
    if (fade > 0) fade = Math.max(0, fade - 0.05);

    if (player.dead) {
      player.deadTimer--;
      if (deathAnim) deathAnim.update(step);
      if (player.deadTimer <= 0) respawn(false);
      return;
    }
    if (player.freeze > 0) {
      player.freeze--;
      return;
    }

    const left = key.left();
    const right = key.right();
    const dir = (right ? 1 : 0) - (left ? 1 : 0);

    // -------- Dash --------
    if (player.dashTime > 0) {
      player.dashTime--;
      if (player.dashTime % 2 === 0)
        Particles.burst(player.x + PW / 2, player.y + PH / 2, {
          count: 2, speed: [5, 25], size: [2, 3], life: [180, 320],
          colors: player.hasDash ? ["#d8e2ff", "#fff"] : ["#7fd6ff", "#bff"],
        });
      if (player.dashTime === 0) {
        player.vx = Math.sign(player.dashDx) * DASH_END_SPEED;
        player.vy = player.dashDy < 0 ? DASH_END_SPEED * -0.4 : 0;
      }
    } else {
      const accel = player.onGround ? RUN_ACCEL : AIR_ACCEL;
      const control = player.wallLock > 0 ? 0.35 : 1;
      if (dir !== 0) {
        player.facing = dir;
        player.vx = Mathf.clamp(player.vx + dir * accel * control, -RUN_MAX, RUN_MAX);
      } else {
        const brake = player.onGround ? GROUND_FRICTION : player.wallLock > 0 ? 1 : AIR_FRICTION;
        player.vx *= brake;
        if (Math.abs(player.vx) < 0.35) player.vx = 0;
      }

      const sliding =
        !player.onGround && player.wallDir !== 0 && player.vy > 0 && dir === player.wallDir;
      player.vy = sliding
        ? Math.min(player.vy + GRAVITY * 0.5, WALL_SLIDE_MAX)
        : Math.min(player.vy + GRAVITY, MAX_FALL);
    }

    if (player.wallLock > 0) player.wallLock--;

    // -------- Jump / wall jump --------
    const pressedJump = key.jumpPress();
    if (player.wallDir !== 0 && !player.onGround) {
      wallCoyote.charge();
      wallCoyoteDir = player.wallDir;
    }
    wallCoyote.tick(step);

    if (jumpGate.update(player.onGround, pressedJump, step)) {
      player.vy = JUMP_V;
      player.onGround = false;
      dust(player.x + PW / 2, player.y + PH, "#e8e2ff");
      Audio.Sfx.jump();
    } else if (pressedJump && !player.onGround && wallCoyote.active) {
      const away = -wallCoyoteDir;
      player.vx = away * WALL_JUMP_VX;
      player.vy = WALL_JUMP_VY;
      player.facing = away;
      player.wallLock = 9;
      wallCoyote.expire();
      dust(player.x + (wallCoyoteDir > 0 ? PW : 0), player.y + PH / 2, "#e8e2ff");
      Audio.Sfx.jump();
    }
    if (!key.jumpHeld() && player.vy < JUMP_V * 0.45) player.vy *= 0.55;

    // -------- Dash trigger --------
    if (key.dashPress() && player.hasDash && player.dashTime === 0) {
      let dx = dir;
      let dy = key.down() ? 1 : key.up() ? -1 : 0;
      if (dx === 0 && dy === 0) dx = player.facing;
      if (dx !== 0 && dy !== 0) {
        player.dashDx = dx * INV_SQRT2;
        player.dashDy = dy * INV_SQRT2;
      } else {
        player.dashDx = dx;
        player.dashDy = dy;
      }
      player.vx = player.dashDx * DASH_SPEED;
      player.vy = player.dashDy * DASH_SPEED;
      player.dashTime = DASH_FRAMES;
      player.freeze = DASH_FREEZE;
      player.hasDash = false;
      if (dx !== 0) player.facing = Math.sign(dx);
      Camera.shake(4, 180);
      Audio.Sfx.blip(660, 0.1, 0.25);
      Audio.Sfx.blip(880, 0.08, 0.2);
      Particles.burst(player.x + PW / 2, player.y + PH / 2, {
        count: 14, speed: [40, 130], size: [2, 4], life: [220, 420],
        colors: ["#d8e2ff", "#fff", "#a0c8ff"],
      });
    }

    // -------- Integrate --------
    const wasAir = !player.onGround;
    player.onGround = false;
    moveX(player.vx);
    moveY(player.vy);
    if (player.vy >= 0 && groundBelow()) {
      const r = Math.floor((player.y + PH + 1) / CELL);
      player.y = r * CELL - PH;
      player.vy = 0;
      player.onGround = true;
    }
    // Landing dust only — no screen shake on touchdown.
    if (player.onGround && wasAir) dust(player.x + PW / 2, player.y + PH, "#d8d2f0");

    player.wallDir = wallOn(1) ? 1 : wallOn(-1) ? -1 : 0;
    if (player.onGround) player.hasDash = true;

    // -------- Hazards --------
    if (spikeHit(level.grid, player.x, player.y, PW, PH) || player.y > WORLD_H + 40) die();

    // -------- Orbs (refill dash) --------
    for (const o of level.orbs) {
      if (o.cd > 0) continue;
      if (Math.abs(o.x - (player.x + PW / 2)) < 13 && Math.abs(o.y - (player.y + PH / 2)) < 15) {
        player.hasDash = true;
        o.cd = 90;
        Audio.Sfx.blip(520, 0.08, 0.2);
        Audio.Sfx.blip(820, 0.08, 0.2);
        Particles.burst(o.x, o.y, {
          count: 12, speed: [40, 120], size: [2, 4], life: [220, 420],
          colors: ["#a0f0ff", "#fff", "#7fd6ff"],
        });
      }
    }

    // -------- Exit --------
    const ex = level.exit.x + CELL / 2;
    const ey = level.exit.y + CELL / 2;
    if (Math.abs(ex - (player.x + PW / 2)) < 16 && Math.abs(ey - (player.y + PH / 2)) < 24)
      nextLevel();

    // -------- Animation --------
    sm.update(step);
    if (player.wallDir !== 0 && sm.is("wall")) player.facing = -player.wallDir;
    anim.update(step);
  },

  draw() {
    const { ctx } = Draw;
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = "#08060f";
    ctx.fillRect(0, 0, vp.w, vp.h);
    if (!ready) {
      ctx.fillStyle = "#cbd";
      ctx.font = "16px system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.fillText("Loading…", vp.w / 2, vp.h / 2);
      ctx.textAlign = "left";
      return;
    }

    const scale = Math.min(vp.w / WORLD_W, vp.h / WORLD_H);
    const offX = (vp.w - WORLD_W * scale) / 2 + Camera.shakeX();
    const offY = (vp.h - WORLD_H * scale) / 2 + Camera.shakeY();
    ctx.save();
    ctx.translate(offX, offY);
    ctx.scale(scale, scale);

    drawBackground(ctx);
    drawProps(ctx);
    drawTiles(ctx);
    drawOrbs(ctx);
    drawExit(ctx);
    Particles.draw(ctx);
    drawPlayer(ctx);

    ctx.restore();

    drawHud(ctx);
    if (fade > 0) {
      ctx.fillStyle = `rgba(6,4,14,${fade})`;
      ctx.fillRect(0, 0, vp.w, vp.h);
    }
    if (won) drawWin(ctx);
  },
});

// ---------------------------------------------------------------------------
// Small fx helper
// ---------------------------------------------------------------------------
function dust(x, y, color) {
  Particles.burst(x, y, {
    count: 7, angle: -Math.PI / 2, spread: Math.PI * 0.9,
    speed: [15, 55], size: [1, 3], life: [180, 360], colors: color,
  });
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------
function drawBackground(ctx) {
  const grad = ctx.createLinearGradient(0, 0, 0, WORLD_H);
  grad.addColorStop(0, level.sky[0]);
  grad.addColorStop(0.55, level.sky[1]);
  grad.addColorStop(1, level.sky[2]);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, WORLD_W, WORLD_H);

  // Tiled dark texture (the 8px bg tile), faint.
  ctx.globalAlpha = 0.25;
  const bg = tex.bg;
  for (let y = 0; y < WORLD_H; y += TILE * 2)
    for (let x = 0; x < WORLD_W; x += TILE * 2)
      ctx.drawImage(bg, x, y, TILE * 2, TILE * 2);
  ctx.globalAlpha = 1;

  // God rays overlay (additive), gently drifting.
  const t = performance.now() * 0.0002;
  ctx.globalAlpha = 0.12;
  ctx.globalCompositeOperation = "screen";
  const rw = 220;
  for (let i = 0; i < 4; i++) {
    const x = ((i * 210 + t * 400) % (WORLD_W + rw)) - rw / 2;
    ctx.drawImage(tex.rays, x, 0, rw, WORLD_H);
  }
  ctx.globalCompositeOperation = "source-over";
  ctx.globalAlpha = 1;

  // Floating motes.
  ctx.fillStyle = "rgba(255,255,255,0.16)";
  const ft = performance.now() * 0.001;
  for (let i = 0; i < 24; i++) {
    const mx = (i * 71 + Math.sin(ft * 0.5 + i) * 20) % WORLD_W;
    const my = (i * 53 + ft * 10) % WORLD_H;
    ctx.fillRect(mx, my, 2, 2);
  }
}

function drawProps(ctx) {
  ctx.globalAlpha = 0.9;
  for (const [kind, c, r] of level.props) {
    const img = tex[kind];
    const w = img.width * 1.4;
    const h = img.height * 1.4;
    ctx.drawImage(img, c * CELL, r * CELL - h, w, h); // base rests on the row's surface
  }
  ctx.globalAlpha = 1;
}

// Pick the 8px tile art for a solid cell by its open neighbours (autotiling).
function tileFor(g, c, r) {
  const openU = !isSolid(g, c, r - 1);
  const openL = !isSolid(g, c - 1, r);
  const openR = !isSolid(g, c + 1, r);
  const openD = !isSolid(g, c, r + 1);
  if (openU) return openL ? tex.grassTL : openR ? tex.grassTR : tex.grassTM;
  if (openD) return openL ? tex.dirtBL : openR ? tex.dirtBR : tex.dirtBM;
  return openL ? tex.dirtML : openR ? tex.dirtMR : tex.dirtMM;
}

function drawTiles(ctx) {
  const g = level.grid;
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const t = g[r][c];
      const x = c * CELL;
      const y = r * CELL;
      if (t === "#") ctx.drawImage(tileFor(g, c, r), x, y, CELL, CELL);
      else if (t === "^") ctx.drawImage(tex.spikeUp, x, y, CELL, CELL);
      else if (t === "V") ctx.drawImage(tex.spikeDown, x, y, CELL, CELL);
    }
  }
}

function drawOrbs(ctx) {
  const t = performance.now() * 0.004;
  for (const o of level.orbs) {
    const bob = Math.sin(t + o.x) * 2;
    ctx.globalAlpha = o.cd > 0 ? 0.28 : 1;
    orbAnim.draw(ctx, o.x, o.y + bob, { w: 26, h: 26 });
    ctx.globalAlpha = 1;
  }
}

function drawExit(ctx) {
  const { x, y } = level.exit;
  const t = performance.now() * 0.003;
  const surface = y + CELL; // the ledge top the exit cell sits above
  let glowY = y + CELL / 2;
  if (level.goal === "house") {
    const img = tex.house;
    const w = img.width * 1.2;
    const h = img.height * 1.2;
    const drawY = surface - tex._houseBase * h; // real base on the ledge
    ctx.drawImage(img, x + CELL / 2 - w / 2, drawY, w, h);
    glowY = drawY + h * 0.7;
  } else {
    const sw = CELL * 1.6;
    const drawY = surface - tex._signBase * sw;
    ctx.drawImage(tex.sign, x + (CELL - sw) / 2, drawY, sw, sw);
    glowY = drawY + sw * 0.4;
  }
  // Beacon glow.
  ctx.globalAlpha = 0.3 + Math.sin(t) * 0.14;
  ctx.fillStyle = "#ffe9a8";
  ctx.beginPath();
  ctx.arc(x + CELL / 2, glowY, 10, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 1;
}

function drawPlayer(ctx) {
  const cx = player.x + PW / 2;
  const feet = player.y + PH;

  if (player.dead) {
    if (deathAnim) deathAnim.draw(ctx, cx, player.y + PH / 2, { w: FRAME, h: FRAME });
    return;
  }

  // Squash / stretch juice.
  let sx = 1;
  let sy = 1;
  if (player.dashTime > 0) {
    const horiz = Math.abs(player.dashDx) >= Math.abs(player.dashDy);
    sx = horiz ? 1.2 : 0.85;
    sy = horiz ? 0.85 : 1.2;
  } else if (!player.onGround) {
    const t = Mathf.clamp(player.vy / MAX_FALL, -1, 1);
    sy = 1 + t * 0.1;
    sx = 1 - t * 0.1;
  }
  const w = FRAME * sx;
  const h = FRAME * sy;

  // The character art sits at ~x-centre with its feet at frame-y FEET_Y (there
  // is ~9px of empty space below in the 32px frame). Anchor that point to the
  // hitbox centre-bottom so the sprite doesn't float, keeping the feet pinned
  // through squash/stretch. Flip via the canvas transform.
  ctx.save();
  ctx.translate(cx, feet);
  ctx.scale(player.facing < 0 ? -1 : 1, 1);
  anim.draw(ctx, 0, 0, { w, h, ax: 0.5, ay: FEET_Y / FRAME });
  ctx.restore();
}

function drawHud(ctx) {
  if (!ready) return;
  const best = bestDeaths === null ? "—" : bestDeaths;
  UI.group({ x: 8, y: 8, w: Math.min(360, vp.w - 16), h: 58, title: level.name }, (body) => {
    UI.text(`Room ${levelIndex + 1}/${LEVELS.length}    Deaths ${deaths}    Best ${best}`, { h: body.remaining, size: 12 });
  });
  UI.group({ x: 8, y: vp.h - 40, w: Math.min(360, vp.w - 16), h: 32 }, (body) => {
    UI.text("←→ move · C/Space jump · X dash · R restart", { h: body.remaining, size: 11, color: "dim" });
  });
}

function drawWin(ctx) {
  ctx.fillStyle = "rgba(8,6,15,0.82)";
  ctx.fillRect(0, 0, vp.w, vp.h);
  ctx.textAlign = "center";
  ctx.fillStyle = "#ffd2e2";
  ctx.font = "bold 40px system-ui, sans-serif";
  ctx.fillText("SUMMIT REACHED", vp.w / 2, vp.h / 2 - 24);
  ctx.fillStyle = "#fff";
  ctx.font = "18px system-ui, sans-serif";
  ctx.fillText(
    `${deaths} deaths   ·   best ${bestDeaths === null ? "—" : bestDeaths}`,
    vp.w / 2, vp.h / 2 + 10,
  );
  ctx.fillStyle = "#9ad";
  ctx.font = "14px system-ui, sans-serif";
  ctx.fillText("Press R to climb again", vp.w / 2, vp.h / 2 + 42);
  ctx.textAlign = "left";
}
