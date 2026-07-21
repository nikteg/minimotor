// API Lab — the IMAGINARY sample. This file is written against the API we
// WISH minimotor had; it is the living spec for a later change-plan, and is
// not expected to compile or run against the current build.
// Agreed changes are tagged [#n] — details in ../API-REVIEW.md.
//
// Increment 13: net — other players appear as ghosts.
import { Anim, Assets, Audio, Camera, Collision, Draw, ECS, Input, Loop, Mathf, Net, Particles, Scenes, Stage, Tiles, Timers, UI, Vec2 } from "minimotor";

// [#1]/[#3] Live viewport, engine-owned background.
Stage.init("game", { background: "#222" });

// [#24] Typed asset manifest; top-level await is the loading boundary.
const art = await Assets.load({ hero: "assets/hero.png", theme: "assets/theme.ogg" });

// [#8] Named actions; zero wiring.
const input = Input.map({
  left:  ["ArrowLeft",  "KeyA", "pad:dpad-left",  "pad:lstick-left"],
  right: ["ArrowRight", "KeyD", "pad:dpad-right", "pad:lstick-right"],
  jump:  ["Space", "ArrowUp", "KeyW", "pad:a"],
  pause: ["Escape", "pad:start"],
});

// [#5] Per-step units; [#11] feel constants are game data.
const MOVE = 3;
const ACCEL = 0.4;
const GRAVITY = 0.5;
const JUMP = -12;
const JUMP_CUTOFF = 0.45;

// [#39] The level IS the source file: ASCII grid + legend. Chars in the
//       legend are tiles; "." and " " are empty; anything else is a spawn
//       MARKER, queryable via level.spawns(char) — tiles stay dumb, the
//       game owns what markers mean.
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
    size: 50, // px per tile
    // [#39-revised] The legend is SEMANTICS ONLY — plain JSON facts. The
    //               whole level def is serializable data: save it, send it
    //               over the net, collide against it server-side (no canvas).
    legend: {
      "#": { solid: true },
      "=": { solid: true, oneWay: true }, // [#13] same flag, same meaning
    },
  },
);

// [#41-revised] Presentation is a SKIN — applied at the draw site, like
//               every other appearance decision. Same level, many skins
//               (themes, minimap). Colors are the zero-asset tier; selector
//               values (tiles.auto16(...), tiles.pick(...)) are the upgrade.
//               `satisfies` checks completeness against the legend: add a
//               tile kind and every skin errors until it answers for it.
const skin = {
  "#": "#3a3f4a",
  "=": "#31555a",
} satisfies Tiles.Skin<typeof level>;

// [#39] Derived geometry: level.rect is the world. No hand-kept world const.
// [#15] The always-existing default camera, configured once.

// [#35]-[#38] Audio: recipes are tweakable specs; sfx/music route to the
//             default buses.
const sfx = Audio.sfx({
  jump: { shape: "square", freq: { from: 520, to: 880 }, ms: 90, volume: 0.4 },
  coin: Audio.recipes.coin(), // [#36]
  thud: { noise: true, freq: { from: 200, to: 60 }, ms: 150, volume: 0.6 },
});
const music = Audio.music(art.theme, { loop: true, volume: 0.5 });

// [#38] Settings are just the default buses + Storage — no settings system.
const audioPrefs = Storage.load("audio", { music: 0.5, sfx: 1.0 });
Audio.buses.music.volume = audioPrefs.music;
Audio.buses.sfx.volume = audioPrefs.sfx;

// [#48] One symmetric ROOM, not host/guest branches: join by name, the
//       star topology (who hosts, relay fan-out, host-drop healing) is
//       internal. Offline is a normal outcome, not an error path.
// [#50] A connection is a RESOURCE (explicit close()), not clock content —
//       net is real IO, the stated exception to #32.
const room = await Net.join("/ws-signal", { room: "api-lab" }).catch(() => null);

// [#49] Declarative replication: say WHAT you share and how often; get an
//       iterable of everyone else's states back, interpolated (numbers
//       lerp between snapshots, other fields step) and timeout-pruned.
const ghosts = room
  ? Net.sync(room, {
      hz: 15,
      state: () => ({ x: player.x, y: player.y, flip: facing < 0 }),
    })
  : null;

// [#32] Content: clock-derived, GC is the teardown.
const gate = Timers.jumpGate({ coyoteMs: 100, bufferMs: 120 }); // [#11]
const fx = Particles.create(); // [#28]
const heroSheet = Anim.sheet(art.hero, { // [#25]
  frame: { w: 32, h: 32 },
  states: {
    idle: { row: 0, frames: 4, fps: 6 },
    run:  { row: 1, frames: 6, fps: 12 },
    jump: { row: 2, frames: 1 },
  },
});
const anim = heroSheet.play("idle");
let facing = 1;
let wasGrounded = false;
let squash = Anim.animate({ from: 1, to: 1, ms: 0 }); // [#27]

const Coin = ECS.component<Vec2>(); // [#21]
const ecs = ECS.create(); // [#23]
let score = 0;
const TOTAL_COINS = level.spawns("o").length; // [#39]

// [#9]/[#12]/[#14] Vec2 + Rect + MoverBody in one plain object.
const start = level.spawnOne("P"); // [#39] marker → tile-center Vec2
const player = {
  x: start.x - 16,
  y: start.y - 16,
  w: 32,
  h: 32,
  vel: { x: 0, y: 0 },
  grounded: false,
};

Camera.follow(player, {
  world: level.rect, // [#39]
  deadzone: { w: 160, h: 100 },
  damping: 0.15,
});

function resetLevel() {
  ecs.clear();
  for (const pos of level.spawns("o")) ecs.spawn(Coin.with(pos)); // [#39]
  player.x = start.x - player.w / 2;
  player.y = start.y - player.h / 2;
  player.vel.x = 0;
  player.vel.y = 0;
  score = 0;
}

function updateWorld() {
  const run = input.axis("left", "right"); // [#8]
  player.vel.x = Mathf.approach(player.vel.x, run * MOVE, ACCEL);

  player.vel.y += GRAVITY;
  if (gate.try(input.jump.pressed, player.grounded)) {
    player.vel.y = JUMP;
    sfx.jump.play(); // [#36]
  }
  if (input.jump.released && player.vel.y < 0) player.vel.y *= JUMP_CUTOFF;

  // [#40] The tilemap IS a solids source — same call as the Solid[] array
  //       was, but the grid gives broadphase for free (only tiles near the
  //       body are tested). Mixed sources compose: [level, movingPlatform].
  const hit = Collision.moveAndSlide(player, level);
  Vec2.clampRect(player, level.rect); // [#10] world edges, structural overload

  ecs.each(Coin, (e, c) => { // [#22] safe despawn-in-iteration
    if (Collision.circleRect(c, 10, player)) {
      ecs.despawn(e);
      score += 1;
      fx.burst({ at: c, count: 12, speed: [1, 3], life: [200, 400], size: [1, 3], color: "#ffd166" }); // [#28]
      sfx.coin.play({ pitch: [0.95, 1.15] }); // [#36] tuple = per-play jitter
    }
  });

  if (run !== 0) facing = Math.sign(run);
  anim.set(!player.grounded ? "jump" : Math.abs(player.vel.x) > 0.5 ? "run" : "idle"); // [#25]

  if (player.grounded && !wasGrounded) {
    squash = Anim.animate({ from: 0.6, to: 1, ms: 150, ease: "easeOut" }); // [#27]
    fx.burst({
      at: { x: player.x + player.w / 2, y: player.y + player.h },
      count: 8, speed: [0.5, 2], life: [150, 300], size: [1, 2], color: "#999",
    });
    if (hit.impact > 8) {
      Camera.shake(Mathf.remap(hit.impact, 8, 16, 1, 5), 150); // [#29]
      sfx.thud.play(); // [#36]
    }
  }
  wasGrounded = player.grounded;
}

function drawWorld() {
  Camera.render(() => { // [#16] world block; top level is screen space
    // [#42] Data never draws itself — Draw owns ALL rendering. The level
    //        and the particle sim are handed TO the renderer, like sprites.
    Draw.tiles(level, skin); // [#39/#41] culled to Camera.rect, for free
    ecs.each(Coin, (_e, c) => Draw.circle(c, 8, "#ffd166")); // [#21]
    // [#49] Ghosts render like anything else — interpolated states are
    //        plain {x, y, ...} objects (structural, #9), drawn where the
    //        game decides.
    if (ghosts) {
      for (const g of ghosts) Draw.rect(g.x, g.y, 32, 32, "#4ecdc466");
    }
    Draw.sprite(anim, player, { flipX: facing < 0, scaleY: squash.value }); // [#26]
    Draw.particles(fx); // [#28]/[#42]
  });
  UI.text(`Coins: ${score}/${TOTAL_COINS}`, { x: 10, y: 8, color: "#888" }); // [#6]
  if (room) UI.text(`${room.peers.length + 1} online`, { anchor: "topRight", x: -10, y: 8, color: "#888" }); // [#33]
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
    },
  },
  playing: {
    enter() {
      resetLevel();
      music.play(); // idempotent [#37]
    },
    update() {
      if (input.pause.pressed) return scenes.push("paused");
      updateWorld();
      if (score === TOTAL_COINS) scenes.go("cleared");
    },
    draw: drawWorld,
  },
  paused: {
    // [#37]/[#38] Ducking is scene policy: fade the instance (this track)
    //             or the bus (all music) — scenes pick the altitude.
    enter() {
      confirmRestart = false;
      music.fade(0.15, 200);
    },
    exit() {
      music.fade(0.5, 200);
      Storage.save("audio", {
        music: Audio.buses.music.volume,
        sfx: Audio.buses.sfx.volume,
      });
    },
    update() {
      if (input.pause.pressed) scenes.pop();
    },
    draw() {
      // [#44] Containers are blocks that auto-flow their children — no
      //       absolute positions inside. The panel anchors like text (#33).
      UI.panel({ anchor: "center", w: 260, pad: 16, gap: 10 }, () => {
        UI.text("PAUSED", { size: 28 });
        // [#43] Interaction is the return value — existence is calling
        //       (immediate mode), identity is the label scoped by the panel.
        if (UI.button("Resume")) scenes.pop();
        if (UI.button("Restart")) confirmRestart = true;
        // [#43] Sliders are value-in/value-out — no binding objects.
        Audio.buses.music.volume = UI.slider("Music", Audio.buses.music.volume);
        Audio.buses.sfx.volume = UI.slider("Sfx", Audio.buses.sfx.volume);
      });
      // [#47] UI.confirm is a WIDGET (backdrop + two buttons + an answer) —
      //       no time/input semantics of its own. Pure UI here, because the
      //       paused scene already froze the world; a mid-GAMEPLAY confirm
      //       would instead be a tiny pushed scene drawing this same call.
      if (confirmRestart) {
        const answer = UI.confirm("Restart level?");
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
    },
  },
});

Loop.run(scenes); // [#31]
