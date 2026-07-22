// Ascent — a Celeste-style precision platformer built from Minimotor
// primitives, dressed in the "Lore" pixel-art set (CC assets under
// ./assets). Three hand-built rooms, Madeline-style movement:
//
//   Assets     — parallel image load, then one composed sprite sheet per state.
//   Anim / Fsm — Idle/Run/Jump/Fall/Wall/Dash clips (real art) driven by a
//                state machine; each state owns a 1:1 sheet cursor.
//   Timers     — jumpGate (coyote + jump buffering) and window latches for the
//                dash refill and wall-jump coyote grace.
//   Particles  — dust puffs, dash bursts; the Lore "Death" burst plays on death.
//   Camera     — screen shake on dash & death (no shake on plain landings).
//   Audio      — jump / dash / death / orb blips.  Storage — best (fewest deaths).
//
// Controls: ←/→ or A/D move · C/Z/Space/↑ jump · X/Shift/K dash (8-directional)
//           R restart room. Dash refills on the ground or a floating orb; the
//           orb goes dim while spent.

import {
  Anim,
  Assets,
  Audio,
  Camera,
  Draw,
  ECS,
  Fsm,
  Gizmos,
  Keys,
  Loop,
  Mathf,
  Particles,
  Perf,
  Sprites,
  Stage,
  Storage,
  Timers,
  UI,
} from "minimotor";
import type { SheetCursor, SpriteLike } from "minimotor";

let vp = Stage.init("game", { plugins: [Perf.plugin()] });
Stage.onResize((next) => (vp = next));

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
// Difficulty comes from Celeste's core idea: wide spike voids with NO ground to
// land on, so the only way across is to chain dashes through floating crystals —
// each crystal is a mandatory mid-air refill. Voids are sized well beyond a
// single jump+dash (~10–11 cells), so skipping a crystal means falling onto
// spikes. Ground still refills, but you never touch it inside a gauntlet.
type Dir = "up" | "down";
interface LevelDef {
  name: string;
  sky: [string, string, string];
  goal: "sign" | "house";
  spawn: [number, number];
  exit: [number, number];
  plats: Array<[number, number, number, number?]>;
  spikes: Array<[number, number, number, Dir]>;
  orbs: Array<[number, number]>;
  props: Array<[string, number, number]>;
}

const LEVELS: LevelDef[] = [
  {
    // One forced 2-crystal chain over a 16-cell void, then a staircase climb.
    name: "Foothills",
    sky: ["#26314f", "#3b4a72", "#6f83a8"],
    goal: "sign",
    spawn: [3, 20],
    exit: [35, 8],
    plats: [
      [1, 21, 10], // start ground (cols 1–9)
      [26, 21, 13], // far ground (cols 26–38)
      [34, 18, 3], // staircase up to the sign
      [30, 15, 3],
      [34, 12, 3],
      [33, 9, 5], // exit ledge
    ],
    spikes: [
      [6, 20, 2, "up"], // a spike to hop on the start ledge
      [10, 21, 16, "up"], // the void floor (cols 10–25) — lethal
    ],
    orbs: [
      [14, 17], // grab to refill mid-flight…
      [20, 17], // …then again to reach the far ground
    ],
    props: [
      ["tree", 2, 21],
      ["rock", 27, 21],
    ],
  },
  {
    // A 2-crystal void, then a wall-jump chimney up to the exit.
    name: "The Crevice",
    sky: ["#1b2436", "#2c3d4a", "#5a7d6a"],
    goal: "sign",
    spawn: [3, 20],
    exit: [35, 4],
    plats: [
      [1, 21, 8], // start ground (cols 1–7)
      [21, 20, 10], // chimney base landing (cols 21–30)
      [24, 9, 2, 10], // left chimney wall (cols 24–25, rows 9–18)
      [29, 9, 2, 10], // right chimney wall (cols 29–30, rows 9–18)
      [29, 8, 9], // top-right platform, caps the right wall
      [33, 5, 5], // exit ledge
    ],
    spikes: [[8, 21, 13, "up"]], // void floor (cols 8–20)
    orbs: [
      [13, 17],
      [19, 15], // chain lifts you onto the chimney landing
    ],
    props: [["rock", 4, 21]],
  },
  {
    // The gauntlet: a 20-cell void crossed by a rising 3-crystal chain, then a
    // zig-zag climb (dodging a spike) to the house.
    name: "Summit",
    sky: ["#241640", "#43306e", "#c06a9a"],
    goal: "house",
    spawn: [3, 20],
    exit: [34, 3],
    plats: [
      [1, 21, 7], // start ground (cols 1–6)
      [27, 13, 6], // landing after the chain (cols 27–32)
      [22, 10, 3], // zig
      [28, 7, 4], // zag
      [31, 4, 7], // house ledge
    ],
    spikes: [
      [7, 21, 20, "up"], // the long void (cols 7–26)
      [29, 12, 2, "up"], // a spike on the landing to dodge
    ],
    orbs: [
      [11, 18], // rising crystal staircase across the void
      [16, 16],
      [21, 14],
    ],
    props: [
      ["tree", 2, 21],
      ["rock", 31, 13],
    ],
  },
];

// ---------------------------------------------------------------------------
// Build a bordered tile grid from a level definition.
// ---------------------------------------------------------------------------
interface OrbDef {
  x: number;
  y: number;
}
interface BuiltLevel {
  grid: string[][];
  orbDefs: OrbDef[];
  spawn: { x: number; y: number };
  exit: { x: number; y: number };
  goal: "sign" | "house";
  sky: [string, string, string];
  name: string;
  props: Array<[string, number, number]>;
}

function buildLevel(def: LevelDef): BuiltLevel {
  const grid = Array.from({ length: ROWS }, () => new Array<string>(COLS).fill(" "));
  const set = (c: number, r: number, ch: string) => {
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

  const orbDefs = def.orbs.map(([c, r]) => ({ x: c * CELL + CELL / 2, y: r * CELL + CELL / 2 }));
  const spawn = { x: def.spawn[0] * CELL + (CELL - PW) / 2, y: (def.spawn[1] + 1) * CELL - PH };
  const exit = { x: def.exit[0] * CELL, y: def.exit[1] * CELL };
  return {
    grid,
    orbDefs,
    spawn,
    exit,
    goal: def.goal,
    sky: def.sky,
    name: def.name,
    props: def.props,
  };
}

function tileAt(grid: string[][], c: number, r: number): string {
  if (c < 0 || c >= COLS || r < 0 || r >= ROWS) return "#";
  return grid[r][c];
}
const isSolid = (grid: string[][], c: number, r: number) => tileAt(grid, c, r) === "#";

// Deadly-tile overlap for a rect (spikes only kill in their business half).
function spikeHit(grid: string[][], x: number, y: number, w: number, h: number): boolean {
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

// Celeste-style tight movement: LINEAR accel/decel (constant per-frame deltas
// via `approach`, not mushy multiplicative friction), a turn-around boost so
// reversing direction is near-instant, and half-gravity near the jump apex for
// a controllable float. All values are px per 60 Hz fixed step.
const GRAVITY = 0.55;
const APEX_VY = 1.2; // |vy| under which gravity is halved (the apex "hang")
const APEX_MULT = 0.5;
const MAX_FALL = 8.5;
const RUN_MAX = 3.6;
const RUN_ACCEL = 0.9; // → max run in ~4 frames
const AIR_ACCEL = 0.65; // responsive air control
const GROUND_DECEL = 1.3; // snappy stop (~3 frames)
const AIR_DECEL = 0.5; // bleed air momentum without a dead stop
const TURN_MULT = 2.2; // extra accel when input opposes velocity (fast flips)
const JUMP_V = -8.1;
const DEATH_POP = -7.5; // Mario-style upward launch on death, then a free fall
const WALL_SLIDE_MAX = 1.7;
const WALL_JUMP_VX = 5.6;
const WALL_JUMP_VY = -8.8;
const DASH_SPEED = 8.4;
const DASH_END_SPEED = 3.6;
const DASH_FRAMES = 11;
const DASH_FREEZE = 3;
const INV_SQRT2 = 0.7071;

// Particle system (immediate-mode bursts, rendered via Draw.particles).
const fx = Particles.create();

// ---------------------------------------------------------------------------
// Sound — layered synth SFX from Audio.tone: a pitched voice plus a filtered
// noise burst per hit, so jumps, dashes and impacts read punchy rather than
// like plain blips.
// ---------------------------------------------------------------------------
const pitched = (
  wave: OscillatorType,
  f0: number,
  f1: number,
  dur: number,
  gain: number,
  delay = 0,
) => Audio.tone({ wave, freq: f1 ? { from: f0, to: f1 } : f0, release: dur, gain, delay });
const burst = (
  type: BiquadFilterType,
  f0: number,
  f1: number,
  q: number,
  dur: number,
  gain: number,
) =>
  Audio.tone({
    wave: "noise",
    release: dur,
    gain,
    filter: { type, freq: f1 ? { from: f0, to: f1 } : f0, q },
  });

const SFX = {
  jump: () => {
    pitched("triangle", 330, 620, 0.13, 0.24);
    burst("bandpass", 900, 1800, 4, 0.09, 0.06);
  },
  wallJump: () => {
    pitched("square", 420, 760, 0.11, 0.16);
    burst("bandpass", 1400, 500, 3, 0.12, 0.09);
  },
  dash: () => {
    burst("bandpass", 1600, 300, 2, 0.2, 0.22);
    pitched("sawtooth", 220, 90, 0.18, 0.14);
  },
  land: (impact: number) => {
    const v = Math.min(0.18, 0.05 + impact * 0.02);
    burst("lowpass", 300, 120, 1, 0.09, v);
    pitched("sine", 150, 80, 0.09, v * 0.7);
  },
  orb: () => {
    [880, 1320, 1760].forEach((f, i) => pitched("sine", f, 0, 0.22, 0.14, i * 0.05));
    burst("bandpass", 3000, 0, 8, 0.18, 0.04);
  },
  death: () => {
    pitched("sawtooth", 420, 70, 0.4, 0.22);
    burst("lowpass", 800, 120, 1, 0.35, 0.14);
  },
  win: () => {
    [523, 659, 784, 1047].forEach((f, i) => pitched("triangle", f, 0, 0.35, 0.2, i * 0.11));
  },
};

const player = {
  x: 0,
  y: 0,
  vx: 0,
  vy: 0,
  facing: 1,
  onGround: false,
  wallDir: 0,
  dashTime: 0,
  dashDx: 0,
  dashDy: 0,
  freeze: 0,
  wallLock: 0,
  dead: false,
  deathSpin: 0,
};

// Celeste-style single air dash: one charge, refilled instantly on the ground
// or a crystal (never on a timer — refillMs is only there to satisfy the API).
const dash = Gizmos.charges({ max: 1, refillMs: 1 });

const jumpGate = Timers.jumpGate({ coyoteMs: 100, bufferMs: 130 });
const wallCoyote = Timers.window(90);
let wallCoyoteDir = 0;

// ---------------------------------------------------------------------------
// Assets & animation (built after load)
// ---------------------------------------------------------------------------
const url = (name: string) => new URL(`../assets/${name}.png`, import.meta.url).href;
const FRAME = 32; // player frame size
const FEET_Y = 23; // frame-y of the character's feet (content ends ~here)

type PlayerState = "idle" | "run" | "jump" | "fall" | "wall" | "dash" | "dead";

let clips!: Record<PlayerState, SheetCursor<"s">>; // one 1:1 sheet cursor per state
let sm!: Fsm.Machine<PlayerState>; // player Fsm
const tex: Record<string, HTMLImageElement> = {}; // decoded tile / prop images by key
const texBase: Record<string, number> = {}; // real opaque base fraction per prop/goal

// Collectibles live on the ECS: one entity per dash orb, drawn by the built-in
// sprite renderer. The crystal art is procedural, so we bake it ONCE into an
// offscreen sheet (a spinning cyan "ready" row + a dim "spent" row) and play it
// like any loaded sprite sheet — no per-frame path drawing.
const CRYSTAL_FR = 16; // rotation frames
const CRYSTAL_FS = 40; // baked frame size (px, includes glow)
let crystalSheet!: HTMLCanvasElement; // the cached canvas
let crystalAnim!: SheetCursor<"spin">; // shared cursor over the "ready" row (drives sx)
const orbWorld = ECS.create();
interface OrbData {
  cd: number;
  baseX: number;
  baseY: number;
}
const Orb = ECS.component<OrbData>("Orb");

// Draw a sheet cursor's current frame at (dx, dy) with an anchor fraction —
// replicates the retired `anim.draw`.
function drawCursor(
  ctx: CanvasRenderingContext2D,
  cur: SpriteLike,
  dx: number,
  dy: number,
  w: number,
  h: number,
  ax = 0.5,
  ay = 0.5,
): void {
  const r = cur.rect;
  ctx.drawImage(cur.sheet.image, r.sx, r.sy, r.sw, r.sh, dx - w * ax, dy - h * ay, w, h);
}

// Bake the spinning dash-crystal with Sprites.atlas: CRYSTAL_FR rotation
// frames per row × 2 rows (row 0 = "ready" cyan + glow, row 1 = "spent" grey).
// origin: "center" translates to each cell's centre, so the diamond rotates
// in place.
function bakeCrystalSheet(): HTMLCanvasElement {
  const s = 8;
  return Sprites.atlas(
    CRYSTAL_FS,
    CRYSTAL_FS,
    CRYSTAL_FR * 2,
    (g: CanvasRenderingContext2D, i: number) => {
      const ready = i < CRYSTAL_FR;
      if (ready) {
        const glow = g.createRadialGradient(0, 0, 2, 0, 0, s * 2.4);
        glow.addColorStop(0, "rgba(160,240,255,0.55)");
        glow.addColorStop(1, "rgba(160,240,255,0)");
        g.fillStyle = glow;
        g.fillRect(-s * 2.4, -s * 2.4, s * 4.8, s * 4.8);
      }
      g.rotate(((i % CRYSTAL_FR) / CRYSTAL_FR) * Math.PI * 2);
      g.beginPath();
      g.moveTo(0, -s);
      g.lineTo(s * 0.72, 0);
      g.lineTo(0, s);
      g.lineTo(-s * 0.72, 0);
      g.closePath();
      g.fillStyle = ready ? "#5fd8ff" : "#7f95a6";
      g.fill();
      g.beginPath();
      g.moveTo(0, -s * 0.55);
      g.lineTo(s * 0.34, 0);
      g.lineTo(0, s * 0.2);
      g.lineTo(-s * 0.34, 0);
      g.closePath();
      g.fillStyle = ready ? "#eafcff" : "#c4d2dc";
      g.fill();
    },
    { cols: CRYSTAL_FR, origin: "center" },
  );
}

const TILE_KEYS = [
  "grassTL",
  "grassTM",
  "grassTR",
  "dirtML",
  "dirtMM",
  "dirtMR",
  "dirtBL",
  "dirtBM",
  "dirtBR",
  "spikeUp",
  "spikeDown",
  "bg",
  "rays",
  "tree",
  "house",
  "rock",
  "sign",
];

function manifest(): Record<string, string> {
  const m: Record<string, string> = {};
  const add = (n: string) => (m[n] = url(n));
  for (let i = 0; i < 4; i++) add(`idle${i}`);
  for (let i = 0; i < 4; i++) add(`run${i}`);
  for (let i = 0; i < 3; i++) add(`jump${i}`);
  for (let i = 0; i < 4; i++) add(`climb${i}`);
  for (const k of TILE_KEYS) add(k);
  return m;
}

function buildAnimations(): void {
  const img = (n: string) => Assets.image(n);
  const compose = (...names: string[]) => Sprites.packAtlas(names.map(img));
  const idleSheet = compose("idle0", "idle1", "idle2", "idle3");
  const runSheet = compose("run0", "run1", "run2", "run3");
  const jumpSheet = compose("jump0", "jump1", "jump2");
  const climbSheet = compose("climb0", "climb1", "climb2", "climb3");

  // Each state is a single-state cursor over its own strip. fall/dash/dead need
  // a specific jump frame, so bake a 1-frame strip of exactly that frame.
  const oneState = (sheet: HTMLCanvasElement, frames: number, fps: number) =>
    Anim.sheet(sheet, {
      frame: { w: FRAME, h: FRAME },
      states: { s: { row: 0, frames, fps } },
    }).play("s");

  clips = {
    idle: oneState(idleSheet, 4, 5),
    run: oneState(runSheet, 4, 13),
    jump: oneState(jumpSheet, 3, 10),
    fall: oneState(Sprites.packAtlas([img("jump2")]), 1, 1),
    wall: oneState(climbSheet, 4, 8),
    dash: oneState(Sprites.packAtlas([img("jump0")]), 1, 1),
    // Death: hold the arms-up launch pose while the body tumbles off-screen.
    dead: oneState(Sprites.packAtlas([img("jump0")]), 1, 1),
  };

  // Cache decoded tile/prop images (drawn directly, scaled in draw calls).
  for (const k of TILE_KEYS) tex[k] = img(k);

  // Measure each prop/goal's real opaque base (fraction of height) so it seats
  // on its surface regardless of transparent padding at the bottom of the art.
  for (const k of ["sign", "house", "tree", "rock"]) {
    const b = Sprites.contentBounds(img(k));
    texBase[k] = (b.y + b.h) / img(k).height;
  }

  // Bake the crystal collectible once; the shared cursor advances the "ready" row.
  crystalSheet = bakeCrystalSheet();
  crystalAnim = Anim.sheet(crystalSheet, {
    frame: { w: CRYSTAL_FS, h: CRYSTAL_FS },
    states: { spin: { row: 0, frames: CRYSTAL_FR, fps: 14 } },
  }).play("spin");

  sm = makeFsm();
}

function makeFsm(): Fsm.Machine<PlayerState> {
  const states: Record<PlayerState, Fsm.State<PlayerState>> = {
    idle: {
      update: () =>
        player.dashTime > 0
          ? "dash"
          : !player.onGround
            ? player.vy < 0
              ? "jump"
              : "fall"
            : Math.abs(player.vx) > 0.4
              ? "run"
              : null,
    },
    run: {
      update: () =>
        player.dashTime > 0
          ? "dash"
          : !player.onGround
            ? player.vy < 0
              ? "jump"
              : "fall"
            : Math.abs(player.vx) <= 0.4
              ? "idle"
              : null,
    },
    jump: {
      update: () =>
        player.dashTime > 0
          ? "dash"
          : player.onGround
            ? "idle"
            : player.wallDir !== 0 && player.vy > 0
              ? "wall"
              : player.vy >= 0
                ? "fall"
                : null,
    },
    fall: {
      update: () =>
        player.dashTime > 0
          ? "dash"
          : player.onGround
            ? "idle"
            : player.wallDir !== 0
              ? "wall"
              : null,
    },
    wall: {
      update: () =>
        player.dashTime > 0
          ? "dash"
          : player.onGround
            ? "idle"
            : player.wallDir === 0
              ? "fall"
              : null,
    },
    dash: {
      update: () =>
        player.dashTime > 0
          ? null
          : player.onGround
            ? "idle"
            : player.wallDir !== 0
              ? "wall"
              : "fall",
    },
    // Terminal state: entered via sm.go("dead"); the update loop drives the
    // pop-and-fall physics directly and resets us out on respawn.
    dead: { update: () => null },
  };
  // No {anim} bridge anymore — reset the entering state's clip on each change.
  return Fsm.create(states, "idle", { onChange: (_from, to) => clips[to].reset() });
}

// ---------------------------------------------------------------------------
// Level / progression state
// ---------------------------------------------------------------------------
let levelIndex = 0;
let level!: BuiltLevel;
let deaths = 0;
let bestDeaths: number | null = Storage.load<number | null>("ascent_best", null);
let won = false;
let ready = false;
let fade = 1;

function loadLevel(i: number): void {
  level = buildLevel(LEVELS[i]);
  // Reset the collectible world and spawn one Orb entity per dash orb.
  const stale: ECS.Entity[] = [];
  for (const [e] of orbWorld.query(Orb)) stale.push(e);
  for (const e of stale) orbWorld.despawn(e);
  for (const { x, y } of level.orbDefs) {
    orbWorld.spawn(
      ECS.Sprite.with({
        x,
        y,
        img: crystalSheet,
        sx: 0,
        sy: 0,
        sw: CRYSTAL_FS,
        sh: CRYSTAL_FS,
        w: 34,
        h: 34,
        z: 1,
      }),
      Orb.with({ cd: 0, baseX: x, baseY: y }),
    );
  }
  respawn(true);
}

function respawn(_hard: boolean): void {
  player.x = level.spawn.x;
  player.y = level.spawn.y;
  player.vx = player.vy = 0;
  player.facing = 1;
  dash.refill();
  player.dashTime = player.freeze = player.wallLock = 0;
  player.dead = false;
  player.deathSpin = 0;
  if (sm) sm.go("idle");
}

function die(): void {
  if (player.dead) return;
  player.dead = true;
  deaths++;
  // Mario-style death: a brief upward pop, then the body free-falls (spinning)
  // through everything and off the bottom of the screen. The Fsm holds the
  // launch pose; the update loop integrates the arc.
  player.vx = 0;
  player.vy = DEATH_POP;
  player.deathSpin = 0;
  player.facing = 1;
  if (sm) sm.go("dead");
  Camera.shake(6, 260);
  SFX.death();
  fx.burst({
    at: { x: player.x + PW / 2, y: player.y + PH / 2 },
    count: 14,
    speed: [40, 140],
    size: [2, 4],
    life: [300, 600],
    color: ["#ffffff", "#c9d0e0", "#7d8598"],
  });
}

function nextLevel(): void {
  if (levelIndex + 1 >= LEVELS.length) {
    won = true;
    if (bestDeaths === null || deaths < bestDeaths) {
      bestDeaths = deaths;
      Storage.save("ascent_best", bestDeaths);
    }
    SFX.win();
    return;
  }
  levelIndex++;
  loadLevel(levelIndex);
  fade = 1;
  SFX.orb();
}

function restartGame(): void {
  levelIndex = 0;
  deaths = 0;
  won = false;
  loadLevel(0);
  fade = 1;
}

// ---------------------------------------------------------------------------
// Collision (axis-separated AABB vs. tile grid)
// ---------------------------------------------------------------------------
function moveX(dx: number): void {
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

function moveY(dy: number): void {
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
function groundBelow(): boolean {
  const g = level.grid;
  const c0 = Math.floor((player.x + 1) / CELL);
  const c1 = Math.floor((player.x + PW - 2) / CELL);
  const r = Math.floor((player.y + PH + 1) / CELL);
  for (let c = c0; c <= c1; c++) if (isSolid(g, c, r)) return true;
  return false;
}

function wallOn(dir: number): boolean {
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
    Keys.pressed("KeyC") ||
    Keys.pressed("KeyZ") ||
    Keys.pressed("Space") ||
    Keys.pressed("ArrowUp"),
  jumpHeld: () =>
    Keys.down("KeyC") || Keys.down("KeyZ") || Keys.down("Space") || Keys.down("ArrowUp"),
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

    if (won) {
      if (Keys.pressed("KeyR")) restartGame();
      return;
    }
    if (Keys.pressed("KeyR")) respawn(true);
    if (fade > 0) fade = Math.max(0, fade - 0.05);

    if (player.dead) {
      // Free-fall arc — no collision, so the corpse drops straight through the
      // level and off the bottom, then we respawn. Spin for the tumble.
      player.vy = Math.min(player.vy + GRAVITY, MAX_FALL * 1.6);
      player.y += player.vy;
      player.x += player.vx;
      player.deathSpin += 0.32;
      if (player.y > WORLD_H + 80) respawn(false);
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
        fx.burst({
          at: { x: player.x + PW / 2, y: player.y + PH / 2 },
          count: 2,
          speed: [5, 25],
          size: [2, 3],
          life: [180, 320],
          color: dash.count > 0 ? ["#d8e2ff", "#fff"] : ["#7fd6ff", "#bff"],
        });
      if (player.dashTime === 0) {
        player.vx = Math.sign(player.dashDx) * DASH_END_SPEED;
        player.vy = player.dashDy < 0 ? DASH_END_SPEED * -0.4 : 0;
      }
    } else {
      // Horizontal: move vx toward its target by a constant delta each frame.
      if (dir !== 0) {
        player.facing = dir;
        const turning = player.vx !== 0 && Math.sign(player.vx) !== dir;
        let acc = (player.onGround ? RUN_ACCEL : AIR_ACCEL) * (turning ? TURN_MULT : 1);
        if (player.wallLock > 0) acc *= 0.4; // brief reduced control after a wall jump
        player.vx = Mathf.approach(player.vx, dir * RUN_MAX, acc);
      } else if (player.wallLock === 0) {
        player.vx = Mathf.approach(player.vx, 0, player.onGround ? GROUND_DECEL : AIR_DECEL);
      }

      // Vertical: gravity, with a half-gravity "hang" near the apex and the
      // gentler wall-slide clamp when pressing into a wall.
      const sliding =
        !player.onGround && player.wallDir !== 0 && player.vy > 0 && dir === player.wallDir;
      if (sliding) {
        player.vy = Math.min(player.vy + GRAVITY * 0.5, WALL_SLIDE_MAX);
      } else {
        const g = Math.abs(player.vy) < APEX_VY ? GRAVITY * APEX_MULT : GRAVITY;
        player.vy = Math.min(player.vy + g, MAX_FALL);
      }
    }

    if (player.wallLock > 0) player.wallLock--;

    // -------- Jump / wall jump --------
    const pressedJump = key.jumpPress();
    if (player.wallDir !== 0 && !player.onGround) {
      wallCoyote.charge();
      wallCoyoteDir = player.wallDir;
    }

    if (jumpGate.try(pressedJump, player.onGround)) {
      player.vy = JUMP_V;
      player.onGround = false;
      dust(player.x + PW / 2, player.y + PH, "#e8e2ff");
      SFX.jump();
    } else if (pressedJump && !player.onGround && wallCoyote.active) {
      const away = -wallCoyoteDir;
      player.vx = away * WALL_JUMP_VX;
      player.vy = WALL_JUMP_VY;
      player.facing = away;
      player.wallLock = 9;
      wallCoyote.expire();
      dust(player.x + (wallCoyoteDir > 0 ? PW : 0), player.y + PH / 2, "#e8e2ff");
      SFX.wallJump();
    }
    if (!key.jumpHeld() && player.vy < JUMP_V * 0.45) player.vy *= 0.55;

    // -------- Dash trigger --------
    if (key.dashPress() && dash.count > 0 && player.dashTime === 0) {
      let dx = dir;
      const dy = key.down() ? 1 : key.up() ? -1 : 0;
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
      dash.use();
      if (dx !== 0) player.facing = Math.sign(dx);
      Camera.shake(4, 180);
      SFX.dash();
      fx.burst({
        at: { x: player.x + PW / 2, y: player.y + PH / 2 },
        count: 14,
        speed: [40, 130],
        size: [2, 4],
        life: [220, 420],
        color: ["#d8e2ff", "#fff", "#a0c8ff"],
      });
    }

    // -------- Integrate --------
    const wasAir = !player.onGround;
    const impactVy = player.vy; // fall speed before grounding zeroes it
    player.onGround = false;
    moveX(player.vx);
    moveY(player.vy);
    if (player.vy >= 0 && groundBelow()) {
      const r = Math.floor((player.y + PH + 1) / CELL);
      player.y = r * CELL - PH;
      player.vy = 0;
      player.onGround = true;
    }
    // Landing: dust + a soft thud scaled to impact (no screen shake on touchdown).
    if (player.onGround && wasAir) {
      dust(player.x + PW / 2, player.y + PH, "#d8d2f0");
      if (impactVy > 2.5) SFX.land(impactVy);
    }

    player.wallDir = wallOn(1) ? 1 : wallOn(-1) ? -1 : 0;
    if (player.onGround) dash.refill();

    // -------- Hazards --------
    if (spikeHit(level.grid, player.x, player.y, PW, PH) || player.y > WORLD_H + 40) die();

    // -------- Orbs (ECS): the shared crystal cursor animates itself; bob and
    // refill on touch.
    const cr = crystalAnim.rect;
    const bt = performance.now() * 0.004;
    const pcx = player.x + PW / 2;
    const pcy = player.y + PH / 2;
    orbWorld.each(ECS.Sprite, Orb, (_e, s, o) => {
      if (o.cd > 0) o.cd--;
      const readyOrb = o.cd === 0;
      s.sx = cr.sx;
      s.sy = readyOrb ? 0 : CRYSTAL_FS; // ready row vs. spent row
      s.sw = cr.sw;
      s.sh = cr.sh;
      s.alpha = readyOrb ? 1 : 0.35;
      s.y = o.baseY + Math.sin(bt + o.baseX) * 2;
      if (readyOrb && Math.abs(o.baseX - pcx) < 17 && Math.abs(o.baseY - pcy) < 18) {
        dash.refill();
        o.cd = 90;
        SFX.orb();
        fx.burst({
          at: { x: o.baseX, y: o.baseY },
          count: 12,
          speed: [40, 120],
          size: [2, 4],
          life: [220, 420],
          color: ["#a0f0ff", "#fff", "#7fd6ff"],
        });
      }
    });

    // -------- Exit --------
    const ex = level.exit.x + CELL / 2;
    const ey = level.exit.y + CELL / 2;
    if (Math.abs(ex - (player.x + PW / 2)) < 16 && Math.abs(ey - (player.y + PH / 2)) < 24)
      nextLevel();

    // -------- Animation --------
    sm.update();
    if (player.wallDir !== 0 && sm.is("wall")) player.facing = -player.wallDir;
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
    const offX = (vp.w - WORLD_W * scale) / 2;
    const offY = (vp.h - WORLD_H * scale) / 2;

    // World block: the default camera is identity, so render() only layers on
    // the screen-shake offset (triggered by Camera.shake on dash/death).
    Camera.render(() => {
      ctx.save();
      ctx.translate(offX, offY);
      ctx.scale(scale, scale);

      drawBackground(ctx);
      drawProps(ctx);
      drawTiles(ctx);
      orbWorld.drawSprites(ctx); // ECS-owned dash crystals
      drawExit(ctx);
      Draw.particles(fx);
      drawPlayer(ctx);

      ctx.restore();
    });

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
function dust(x: number, y: number, color: string): void {
  fx.burst({
    at: { x, y },
    count: 7,
    angle: -Math.PI / 2,
    spread: Math.PI * 0.9,
    speed: [15, 55],
    size: [1, 3],
    life: [180, 360],
    color,
  });
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------
function drawBackground(ctx: CanvasRenderingContext2D): void {
  const grad = ctx.createLinearGradient(0, 0, 0, WORLD_H);
  grad.addColorStop(0, level.sky[0]);
  grad.addColorStop(0.55, level.sky[1]);
  grad.addColorStop(1, level.sky[2]);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, WORLD_W, WORLD_H);

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

function drawProps(ctx: CanvasRenderingContext2D): void {
  ctx.globalAlpha = 0.9;
  for (const [kind, c, r] of level.props) {
    const img = tex[kind];
    const w = img.width * 1.4;
    const h = img.height * 1.4;
    // Seat the sprite's real (opaque) base on the row's surface, ignoring any
    // transparent padding below the art.
    const drawY = r * CELL - texBase[kind] * h;
    ctx.drawImage(img, c * CELL, drawY, w, h);
  }
  ctx.globalAlpha = 1;
}

// Pick the 8px tile art for a solid cell by its open neighbours (autotiling).
function tileFor(g: string[][], c: number, r: number): HTMLImageElement {
  const openU = !isSolid(g, c, r - 1);
  const openL = !isSolid(g, c - 1, r);
  const openR = !isSolid(g, c + 1, r);
  const openD = !isSolid(g, c, r + 1);
  if (openU) return openL ? tex.grassTL : openR ? tex.grassTR : tex.grassTM;
  if (openD) return openL ? tex.dirtBL : openR ? tex.dirtBR : tex.dirtBM;
  return openL ? tex.dirtML : openR ? tex.dirtMR : tex.dirtMM;
}

const DIRT_BASE = "#2a2027"; // fill under solid cells so no tile has a see-through seam

function drawTiles(ctx: CanvasRenderingContext2D): void {
  const g = level.grid;
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const t = g[r][c];
      const x = c * CELL;
      const y = r * CELL;
      if (t === "#") {
        // Base fill first — some dirt tiles are not fully opaque, which would
        // otherwise let the sky show through as a grid between cells.
        ctx.fillStyle = DIRT_BASE;
        ctx.fillRect(x, y, CELL, CELL);
        ctx.drawImage(tileFor(g, c, r), x, y, CELL, CELL);
      } else if (t === "^") ctx.drawImage(tex.spikeUp, x, y, CELL, CELL);
      else if (t === "V") ctx.drawImage(tex.spikeDown, x, y, CELL, CELL);
    }
  }
}

function drawExit(ctx: CanvasRenderingContext2D): void {
  const { x, y } = level.exit;
  const t = performance.now() * 0.003;
  const surface = y + CELL; // the ledge top the exit cell sits above
  let glowY = y + CELL / 2;
  if (level.goal === "house") {
    const img = tex.house;
    const w = img.width * 1.2;
    const h = img.height * 1.2;
    const drawY = surface - texBase.house * h; // real base on the ledge
    ctx.drawImage(img, x + CELL / 2 - w / 2, drawY, w, h);
    glowY = drawY + h * 0.7;
  } else {
    const sw = CELL * 1.6;
    const drawY = surface - texBase.sign * sw;
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

function drawPlayer(ctx: CanvasRenderingContext2D): void {
  const cx = player.x + PW / 2;
  const feet = player.y + PH;
  const cur = clips[sm.current];

  if (player.dead) {
    // Tumbling launch pose, rotated around the body centre.
    ctx.save();
    ctx.translate(cx, player.y + PH / 2);
    ctx.rotate(player.deathSpin);
    drawCursor(ctx, cur, 0, 0, FRAME, FRAME, 0.5, 0.5);
    ctx.restore();
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
  drawCursor(ctx, cur, 0, 0, w, h, 0.5, FEET_Y / FRAME);
  ctx.restore();
}

function drawHud(ctx: CanvasRenderingContext2D): void {
  if (!ready) return;
  const best = bestDeaths === null ? "—" : bestDeaths;
  UI.group({ x: 8, y: 8, w: Math.min(360, vp.w - 16), h: 58, title: level.name }, (body) => {
    UI.text(`Room ${levelIndex + 1}/${LEVELS.length}    Deaths ${deaths}    Best ${best}`, {
      h: body.remaining,
      size: 12,
    });
  });
  drawDashPip(ctx);
  UI.group({ x: 8, y: vp.h - 40, w: Math.min(360, vp.w - 16), h: 32 }, (body) => {
    UI.text("←→ move · C/Space jump · X dash · R restart", {
      h: body.remaining,
      size: 11,
      color: "dim",
    });
  });
}

// Dash charge indicator — a small diamond, bright cyan when dash is ready and
// dim/hollow when spent, so the player can read their charge at a glance.
function drawDashPip(ctx: CanvasRenderingContext2D): void {
  const cx = 8 + 12;
  const cy = 8 + 58 + 16; // just below the info group box
  const s = 8;
  const ready = dash.count > 0;
  ctx.save();
  ctx.translate(cx, cy);
  if (ready) {
    ctx.shadowColor = "#5fd8ff";
    ctx.shadowBlur = 10;
  }
  ctx.beginPath();
  ctx.moveTo(0, -s);
  ctx.lineTo(s * 0.72, 0);
  ctx.lineTo(0, s);
  ctx.lineTo(-s * 0.72, 0);
  ctx.closePath();
  if (ready) {
    ctx.fillStyle = "#5fd8ff";
    ctx.fill();
  } else {
    ctx.strokeStyle = "rgba(127,149,166,0.7)";
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }
  ctx.restore();
  ctx.shadowBlur = 0;
  ctx.fillStyle = ready ? "#cbeefb" : "#7f95a6";
  ctx.font = "11px system-ui, sans-serif";
  ctx.fillText("DASH", cx + 12, cy + 4);
}

function drawWin(ctx: CanvasRenderingContext2D): void {
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
    vp.w / 2,
    vp.h / 2 + 10,
  );
  ctx.fillStyle = "#9ad";
  ctx.font = "14px system-ui, sans-serif";
  ctx.fillText("Press R to climb again", vp.w / 2, vp.h / 2 + 42);
  ctx.textAlign = "left";
}
