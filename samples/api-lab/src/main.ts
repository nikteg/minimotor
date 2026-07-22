// API Lab — the sample that DESIGNED the new API, now running for real.
// Built increment by increment as an imaginary-API exercise (decision log in
// ../API-REVIEW.md, numbered [#n]); the engine then implemented the spec
// (../../API_PLAN.md). Divergences from the imaginary version: the hero
// spritesheet is generated in code and the music track is omitted (no binary
// assets in the repo) — everything else is the spec, live.
import {
  Anim,
  Audio,
  Camera,
  Collision,
  Draw,
  ECS,
  Input,
  Loop,
  Mathf,
  Net,
  Particles,
  Scenes,
  Stage,
  Storage,
  Tiles,
  Timers,
  UI,
  Vec2,
} from "minimotor";

// [#1]/[#3] Live viewport, engine-owned background.
Stage.init("game", { background: "#222" });

// [#8] Named actions over fused devices; zero wiring.
const input = Input.map({
  left: ["ArrowLeft", "KeyA", "pad:dpad-left", "pad:lstick-left"],
  right: ["ArrowRight", "KeyD", "pad:dpad-right", "pad:lstick-right"],
  jump: ["Space", "ArrowUp", "KeyW", "pad:a"],
  dash: ["ShiftLeft", "ShiftRight", "KeyX", "pad:b"],
  pause: ["Escape", "pad:start"],
});

// [#5] Per-step units (px/step, px/step²); [#11] feel constants are game data.
const MOVE = 3;
const ACCEL = 0.4;
const GRAVITY = 0.5;
const JUMP = -12;
const JUMP_CUTOFF = 0.45;
const WALL_SLIDE = 1.4; // max fall speed while pressing into a wall
const WALL_JUMP_X = 4.5; // horizontal kick away from the wall
const DASH_SPEED = 9;

// [#39] The level IS the source file: ASCII grid + semantics-only legend.
const level = Tiles.grid(
  `
................................................
................................................
................................................
......o.................o......................
.....===...............===.....................
..............o.......................o........
.............===.............======............
...o......................o.....................
..===........#####.......===........o..........
.............#...#.................====.........
..P..........#...#..............................
################################################
`,
  {
    size: 50,
    legend: {
      "#": { solid: true },
      "=": { solid: true, oneWay: true }, // [#13]
    },
  },
);

// [#41] Presentation is a SKIN, applied at the draw site; `satisfies` checks
//       completeness against the legend.
const skin = {
  "#": "#3a3f4a",
  "=": "#31555a",
} satisfies Tiles.Skin<typeof level>;

// [#35]-[#38] Synth sfx on the default buses; recipes are tweakable specs.
const sfx = Audio.sfx({
  jump: { shape: "square", freq: { from: 520, to: 880 }, ms: 90, volume: 0.4 },
  coin: Audio.recipes.coin(), // [#36]
  dash: Audio.recipes.whoosh(),
  thud: {
    noise: true,
    freq: 120,
    ms: 150,
    volume: 0.6,
    filter: { type: "lowpass", freq: { from: 200, to: 60 } },
  },
});

// [#38] Settings are just the default buses + Storage — no settings system.
const audioPrefs = Storage.load("api-lab:audio", { music: 0.5, sfx: 1.0 });
Audio.buses.music.volume = audioPrefs.music;
Audio.buses.sfx.volume = audioPrefs.sfx;

// [#48]/[#50] One symmetric ROOM; offline is a normal outcome.
const room = await Net.join(
  `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws-signal`,
  {
    room: "api-lab",
  },
).catch(() => null);

// [#49] Declarative replication: share position, get interpolated ghosts.
const ghosts = room
  ? Net.sync(room, {
      hz: 15,
      state: () => ({ x: player.x, y: player.y }),
    })
  : null;

// [#25] The hero sheet — generated art (a breathing, running square with a
//       face) so the sample ships without binary assets.
function makeHeroImage(): HTMLCanvasElement {
  const c = document.createElement("canvas");
  c.width = 6 * 32;
  c.height = 3 * 32;
  const g = c.getContext("2d")!;
  const drawHero = (col: number, row: number, squish: number, lean: number) => {
    const x = col * 32;
    const y = row * 32;
    const h = 24 - squish;
    g.save();
    g.translate(x + 16, y + 32);
    g.transform(1, 0, lean, 1, 0, 0); // run lean (kept tiny: frames must stay in-cell)
    g.fillStyle = row === 2 ? "#ffd166" : "#4ecdc4";
    // Body fills the collision box (1px cell margin so frames never bleed
    // into sheet neighbours): flush against walls when colliding sideways.
    g.fillRect(-15, -h, 30, h);
    g.fillStyle = "#1b2528";
    g.fillRect(-8, -h + 6, 5, 5); // eyes
    g.fillRect(3, -h + 6, 5, 5);
    g.restore();
  };
  for (let f = 0; f < 4; f++) drawHero(f, 0, f === 1 || f === 2 ? 1 : 0, 0); // idle breathe
  for (let f = 0; f < 6; f++) drawHero(f, 1, f % 3 === 0 ? 2 : 0, f % 2 === 0 ? 0.06 : -0.03); // run
  drawHero(0, 2, -3, 0); // jump stretch
  return c;
}

const heroSheet = Anim.sheet(makeHeroImage(), {
  frame: { w: 32, h: 32 },
  states: {
    idle: { row: 0, frames: 4, fps: 6 },
    run: { row: 1, frames: 6, fps: 12 },
    jump: { row: 2, frames: 1 },
  },
});
const anim = heroSheet.play("idle");
let facing = 1;
let wasGrounded = false;
let squash = Anim.animate({ from: 1, to: 1, ms: 1 }); // [#27]

// [#32] Content: clock-derived, GC is the teardown.
const gate = Timers.jumpGate({ coyoteMs: 100, bufferMs: 120 }); // [#11]
// Wall jumps get their own coyote window; dashes a duration + cooldown.
const wallCoyote = Timers.window(100);
const dashActive = Timers.window(130);
const dashCooldown = Timers.cooldown(400);
let wallDir = 0; // -1 = wall on our left, +1 = on our right
let canAirDash = true;
let dashDir = 1;
const fx = Particles.create(); // [#28]

const Coin = ECS.component<Vec2>(); // [#21]
const ecs = ECS.create(); // [#23]
let score = 0;
const TOTAL_COINS = level.spawns("o").length; // [#39]

// [#9]/[#12]/[#14] Vec2 + Rect + MoverBody in one plain object.
const start = level.spawnOne("P");
const player = {
  x: start.x - 16,
  y: start.y - 16,
  w: 32,
  h: 32,
  vel: { x: 0, y: 0 },
  grounded: false,
};

// [#15] The always-existing default camera, configured once.
Camera.follow(player, {
  world: level.rect, // [#39]
  deadzone: { w: 160, h: 100 },
  damping: 0.15,
});

function resetLevel(): void {
  ecs.clear();
  for (const pos of level.spawns("o")) ecs.spawn(Coin.with(pos));
  player.x = start.x - player.w / 2;
  player.y = start.y - player.h / 2;
  player.vel.x = 0;
  player.vel.y = 0;
  score = 0;
  Camera.snap();
}

function updateWorld(): void {
  const run = input.axis("left", "right"); // [#8]
  // The window/cooldown timers are clock-derived (no tick) — they read
  // Clock.game, so nothing to advance here.
  const dashing = dashActive.active;
  if (dashing) {
    // A dash owns the velocity: fixed speed, gravity suspended, trail.
    player.vel.x = dashDir * DASH_SPEED;
    player.vel.y = 0;
    fx.emit({
      at: { x: player.x + player.w / 2, y: player.y + player.h / 2 },
      speed: [0.1, 0.6],
      life: [120, 260],
      size: [2, 4],
      color: "#9ee7ff",
    });
  } else {
    player.vel.x = Mathf.approach(player.vel.x, run * MOVE, ACCEL);
    player.vel.y += GRAVITY;
  }

  // Ground jump (coyote + buffer via the gate), else wall jump (its own
  // coyote window charged by recent wall contact).
  if (gate.try(input.jump.pressed, player.grounded)) {
    player.vel.y = JUMP;
    sfx.jump.play(); // [#36]
  } else if (input.jump.pressed && !player.grounded && wallCoyote.active) {
    player.vel.y = JUMP * 0.9;
    player.vel.x = -wallDir * WALL_JUMP_X;
    facing = -wallDir;
    wallCoyote.expire(); // one jump per wall touch
    dashActive.expire(); // a wall jump interrupts a dash
    sfx.jump.play({ pitch: 1.25 });
    fx.burst({
      at: { x: player.x + (wallDir > 0 ? player.w : 0), y: player.y + player.h / 2 },
      count: 6,
      speed: [0.5, 2],
      life: [120, 240],
      size: [1, 2],
      color: "#9ee7ff",
    });
  }
  if (input.jump.released && player.vel.y < 0 && !dashing) player.vel.y *= JUMP_CUTOFF;

  // Dash: on the edge, off cooldown, once per airtime (refreshes on landing).
  if (input.dash.pressed && dashCooldown.ready() && (player.grounded || canAirDash)) {
    if (!player.grounded) canAirDash = false;
    dashDir = run !== 0 ? Math.sign(run) : facing;
    facing = dashDir;
    dashActive.charge();
    dashCooldown.use();
    sfx.dash.play();
    Camera.shake(2, 100); // [#29]
  }

  // [#14]/[#40] Policy path against the tilemap: grid broadphase for free.
  const hit = Collision.moveAndSlide(player, level);
  Vec2.clampRect(player, 0, 0, level.rect.w - player.w, level.rect.h - player.h); // [#10]

  // Wall state (from this step's contacts): recent touch charges the wall
  // coyote; pressing into the wall while falling becomes a wall slide.
  if (!player.grounded && (hit.left || hit.right)) {
    wallDir = hit.left ? -1 : 1;
    wallCoyote.charge();
    dashActive.expire(); // dashing into a wall ends the dash
    if (run === wallDir && player.vel.y > WALL_SLIDE) player.vel.y = WALL_SLIDE;
  }
  if (player.grounded) canAirDash = true;

  ecs.each(Coin, (e, c) => {
    // [#22] safe despawn-in-iteration
    if (Collision.circleRect(c.x, c.y, 10, player)) {
      ecs.despawn(e);
      score += 1;
      fx.burst({
        at: c,
        count: 12,
        speed: [1, 3],
        life: [200, 400],
        size: [1, 3],
        color: "#ffd166",
      }); // [#28]
      sfx.coin.play({ pitch: [0.95, 1.15] }); // [#36] tuple = per-play jitter
    }
  });

  if (run !== 0 && !dashing) facing = Math.sign(run);
  anim.set(!player.grounded || dashing ? "jump" : Math.abs(player.vel.x) > 0.5 ? "run" : "idle"); // [#25]

  if (player.grounded && !wasGrounded) {
    squash = Anim.animate({ from: 0.6, to: 1, ms: 150, ease: Mathf.easeOut }); // [#27]
    fx.burst({
      at: { x: player.x + player.w / 2, y: player.y + player.h },
      count: 8,
      speed: [0.5, 2],
      life: [150, 300],
      size: [1, 2],
      color: "#999",
    });
    if (hit.impact > 8) {
      Camera.shake(Mathf.remap(hit.impact, 8, 16, 1, 5), 150); // [#29]
      sfx.thud.play();
    }
  }
  wasGrounded = player.grounded;
}

function drawWorld(): void {
  // [#16] Screen space is the default; the camera transforms its block.
  Camera.render(() => {
    Draw.tiles(level, skin); // [#42] data never draws itself
    for (const c of ecs.dense(Coin)) Draw.circle(c, 8, "#ffd166"); // [#21] data pass, no entity
    if (ghosts) {
      for (const g of ghosts) Draw.rect(g.x, g.y, 32, 32, "#4ecdc466"); // [#49]
    }
    Draw.sprite(anim, player, { flipX: facing < 0, scaleY: squash.value }); // [#26]
    Draw.particles(fx); // [#28]
  });
  UI.text(`Coins: ${score}/${TOTAL_COINS}`, { x: 10, y: 8, color: "#888" }); // [#6]
  if (room)
    UI.text(`${room.peers.length + 1} online`, { anchor: "topRight", x: -10, y: 8, color: "#888" }); // [#33]
}

let confirmRestart = false;

// [#31] Typed scene map; the stack is a draw order AND a time boundary.
const scenes = Scenes.create({
  title: {
    update() {
      if (input.jump.pressed) scenes.go("playing");
    },
    draw() {
      UI.text("API LAB", { anchor: "center", y: -30, size: 32 }); // [#33]
      UI.text("Space to start", { anchor: "center", y: 10, color: "#888" });
      UI.text("run · jump · wall jump · Shift to dash", { anchor: "center", y: 36, color: "#555" });
    },
  },
  playing: {
    enter: resetLevel,
    update() {
      if (input.pause.pressed) return scenes.push("paused");
      updateWorld();
      if (score === TOTAL_COINS) scenes.go("cleared");
    },
    draw: drawWorld,
  },
  paused: {
    // [#31] push held Clock.game — the world below is frozen mid-air.
    enter() {
      confirmRestart = false;
    },
    exit() {
      Storage.save("api-lab:audio", {
        music: Audio.buses.music.volume,
        sfx: Audio.buses.sfx.volume,
      });
    },
    update() {
      if (input.pause.pressed) scenes.pop();
    },
    draw() {
      // `playing` re-draws beneath us (non-opaque stack) — frozen mid-air.
      UI.panel({ anchor: "center", w: 260, pad: 16, gap: 10, id: "pause" }, () => {
        UI.text("PAUSED", { size: 28 });
        if (UI.button("Resume")) scenes.pop();
        if (UI.button("Restart")) confirmRestart = true; // [#47]
        Audio.buses.music.volume = UI.slider("Music", Audio.buses.music.volume); // [#43]
        Audio.buses.sfx.volume = UI.slider("Sfx", Audio.buses.sfx.volume);
      });
      if (confirmRestart) {
        const answer = UI.confirm("Restart level?"); // [#47]
        if (answer === "yes") scenes.go("playing");
        if (answer) confirmRestart = false;
      }
    },
  },
  cleared: {
    update() {
      if (input.jump.pressed) scenes.go("playing");
    },
    draw() {
      drawWorld();
      UI.text("CLEARED!", { anchor: "center", size: 32, color: "#ffd166" }); // [#33]
      UI.text("Space to play again", { anchor: "center", y: 30, color: "#888" });
    },
  },
});

Loop.run(scenes); // [#31] the stack IS the callbacks, structurally
