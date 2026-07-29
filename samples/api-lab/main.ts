// API Lab — one small game exercising the public API. [#n] references
// API-REVIEW.md.
import {
  Anim,
  Audio,
  Camera,
  Collision,
  Draw,
  Input,
  Loop,
  Mathf,
  Net,
  OnscreenInput,
  Particles,
  Perf,
  Scenes,
  App,
  Storage,
  Tiles,
  Timers,
  UI,
  Vec2,
  type SceneSpec,
} from "minimotor";
import type { GameProtocol } from "./protocol.js";

// [#1]/[#3] Live viewport, engine-owned background.
App.init("game", { background: "#222" });

// On-screen touch gamepad; autohides on desktop, shows on touch.
export const pad = OnscreenInput.gamepad({
  opacity: 0.55,
  stick: { anchor: { side: "left", x: 90, y: 90 }, radius: 60 },
  buttons: [
    { anchor: { side: "right", x: 128, y: 82 }, r: 48, button: "a", label: "JUMP" },
    { anchor: { side: "right", x: 44, y: 130 }, r: 32, button: "x", label: "DASH" },
  ],
});

// [#8] Named actions over fused devices; zero wiring.
const input = Input.map(
  {
    left: ["ArrowLeft", "KeyA", "pad:dpad-left", "pad:lstick-left"],
    right: ["ArrowRight", "KeyD", "pad:dpad-right", "pad:lstick-right"],
    down: ["ArrowDown", "KeyS", "pad:dpad-down", "pad:lstick-down"],
    jump: ["ArrowUp", "KeyW", "KeyZ", "pad:a"],
    dash: ["Space", "KeyX", "pad:x"],
    pause: ["Escape", "pad:start"],
  },
  { pad },
);

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
  "=": null,
} satisfies Tiles.Skin<typeof level>;
const platforms: { x: number; y: number; w: number; h: number }[] = [];
for (let cy = 0; cy < level.rows; cy++)
  for (let cx = 0; cx < level.cols; cx++)
    if (level.at(cx, cy) === "=")
      platforms.push({ x: cx * level.size, y: cy * level.size, w: level.size, h: 8 });

// [#35]-[#38] Synth sfx on the default buses; recipes are tweakable specs.
const sfx = Audio.sfx({
  jump: { shape: "square", freq: { from: 520, to: 880 }, ms: 90, volume: 0.4 },
  coin: Audio.Recipes.coin(), // [#36]
  dash: Audio.Recipes.whoosh(),
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

// [#25] The hero sheet — generated art (a breathing, running square with a
//       face) so the sample ships without binary assets.
const heroLooks = [
  [0, 0],
  [-2, -2],
  [0, -2],
  [2, -2],
  [-2, 0],
  [2, 0],
  [-2, 2],
  [0, 2],
  [2, 2],
] as const;

function makeHeroImage(color: string): HTMLCanvasElement {
  const statesPerLook = 4;
  const c = document.createElement("canvas");
  c.width = 6 * 32;
  c.height = heroLooks.length * statesPerLook * 32;
  const g = c.getContext("2d")!;
  const eyes = (h: number, look: (typeof heroLooks)[number], x = 0) => {
    g.fillStyle = "#1b2528";
    g.fillRect(x - 8 + look[0], -h + 6 + look[1], 5, 5);
    g.fillRect(x + 3 + look[0], -h + 6 + look[1], 5, 5);
  };
  const drawHero = (
    col: number,
    row: number,
    squish: number,
    lean: number,
    look: (typeof heroLooks)[number],
  ) => {
    const x = col * 32;
    const y = row * 32;
    const h = Math.min(32, 31 - squish);
    g.save();
    g.translate(x + 16, y + 32);
    g.transform(1, 0, lean, 1, 0, 0); // run lean (kept tiny: frames must stay in-cell)
    g.fillStyle = color;
    // Body fills the collision box (1px cell margin so frames never bleed
    // into sheet neighbours): flush against walls when colliding sideways.
    g.fillRect(-15, -h, 30, h);
    eyes(h, look);
    g.restore();
  };
  const drawDash = (col: number, row: number, look: (typeof heroLooks)[number]) => {
    const x = col * 32;
    const y = row * 32;
    const bob = col % 2;
    const h = 20;
    g.save();
    g.translate(x + 16, y + 31 - bob);
    g.transform(1, 0, 0.12, 1, 0, 0);
    g.fillStyle = color;
    g.beginPath();
    g.moveTo(-15, -h);
    g.lineTo(9, -h);
    g.lineTo(15, -h / 2);
    g.lineTo(9, 0);
    g.lineTo(-12, 0);
    g.lineTo(-15, -4);
    g.lineTo(-9 - (col % 3), -7);
    g.lineTo(-15, -10);
    g.lineTo(-9 + (col % 2), -14);
    g.closePath();
    g.fill();
    eyes(h, look, 1);
    g.restore();
  };
  for (let look = 0; look < heroLooks.length; look++) {
    const row = look * statesPerLook;
    for (let f = 0; f < 4; f++) drawHero(f, row, f === 1 || f === 2 ? 1 : 0, 0, heroLooks[look]); // idle breathe
    for (let f = 0; f < 6; f++)
      drawHero(f, row + 1, f % 3 === 0 ? 2 : 0, f % 2 === 0 ? 0.06 : -0.03, heroLooks[look]); // run
    drawHero(0, row + 2, -3, 0, heroLooks[look]); // jump stretch
    for (let f = 0; f < 4; f++) drawDash(f, row + 3, heroLooks[look]);
  }
  return c;
}

function heroAnimation(color: string) {
  const sheet = Anim.sheet(makeHeroImage(color), {
    frame: { w: 32, h: 32 },
    states: {
      idle: { row: 0, frames: 4, fps: 6 },
      run: { row: 1, frames: 6, fps: 12 },
      jump: { row: 2, frames: 1 },
      dash: { row: 3, frames: 4, fps: 24 },
    },
  });
  const cursor = sheet.play("idle");
  const rect = { sx: 0, sy: 0, sw: 32, sh: 32 };
  let look = 0;
  return {
    get sheet() {
      return sheet;
    },
    get rect() {
      const current = cursor.rect;
      rect.sx = current.sx;
      rect.sy = current.sy + look * 4 * 32;
      return rect;
    },
    set: cursor.set,
    look(vx: number, vy: number, facing: number) {
      if (Math.hypot(vx, vy) <= 0.5) return void (look = 0);
      const x = Math.sign(vx) * facing * 2;
      const y = Math.sign(vy) * 2;
      look = heroLooks.findIndex(([lx, ly]) => lx === x && ly === y);
    },
  };
}

const PLAYER_COLOR = "#4ecdc4";
const colorFor = (index: number) => `hsl(${(index * 137.508 + 174) % 360} 70% 62%)`;

let playerAnimation = heroAnimation(PLAYER_COLOR);
const ghostAnimations = new Map<string, ReturnType<typeof heroAnimation>>();
let wasGrounded = false;
let squash = Anim.animate({ from: 1, to: 1, ms: 1 }); // [#27]

// [#32] Content: clock-derived, GC is the teardown.
const gate = Timers.jumpGate({ coyoteMs: 100, bufferMs: 120 }); // [#11]
// Wall jumps get their own coyote window; dashes a duration + cooldown.
const wallCoyote = Timers.window(100);
const dashActive = Timers.window(130);
const dashCooldown = Timers.cooldown(400);
const bumpCooldown = Timers.cooldown(250);
let wallDir = 0; // -1 = wall on our left, +1 = on our right
let canAirDash = true;
const fx = Particles.create(); // [#28]

const coinSpawns = level.spawns("o");
let score = 0;

// [#9]/[#12]/[#14] Vec2 + Rect + MoverBody in one plain object.
const start = level.spawnOne("P");
const player = {
  x: start.x - 16,
  y: start.y - 16,
  w: 32,
  h: 32,
  vel: { x: 0, y: 0 },
  grounded: false,
  facing: 1,
  color: PLAYER_COLOR,
  active: false,
};

// [#15] The always-existing default camera, configured once.
Camera.follow(player, {
  world: level.rect, // [#39]
  deadzone: { w: 160, h: 100 },
  damping: 0.15,
});

// One room, online or offline. The fallback keeps every Net helper on the same
// code path; syncBody, hostState, events, and networkTime own the wire details.
const signalUrl = `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/ws-signal`;
const room = Net.monitorRoom(
  await Net.join(signalUrl, { room: "api-lab", fallback: "local", timeoutMs: 1500 }),
);
Loop.use(Perf.plugin({ net: room.meter, layout: "horizontal" }));
player.color = colorFor(Net.memberIndex(room));
playerAnimation = heroAnimation(player.color);
// One-frame interpolation on a stable LAN; the adaptive buffer grows only
// when packet arrival becomes jittery.
const ghosts = Net.syncBody(room, player);
const netTime = Net.networkTime(room);
const gameEvents = Net.events<GameProtocol>(room);
const coins = Net.sharedItems(room, coinSpawns, {
  channel: "coins",
  respawnMs: 4000,
  now: () => netTime.now,
  canTake(coin, by) {
    const collector = by === room.id ? player : ghosts.latest(by);
    return !!collector?.active && !!Collision.circleRect(coin.x, coin.y, 24, collector);
  },
  onTake(coin, by) {
    if (by === room.id) score++;
  },
  onEffect(coin) {
    fx.burst({
      at: coin,
      count: 12,
      speed: [1, 3],
      life: [200, 400],
      size: [1, 3],
      color: "#ffd166",
    });
    sfx.coin.play({ pitch: [0.95, 1.15] });
  },
});

gameEvents.on("bump", ({ target, vx, vy }) => {
  if (target !== room.id) return;
  player.vel.x = vx;
  player.vel.y = vy;
  dashActive.expire();
  Camera.shake(3, 120);
});

function resetLevel(active = true): void {
  player.x = start.x - player.w / 2 + Net.memberIndex(room) * 36;
  player.y = start.y - player.h / 2;
  player.vel.x = 0;
  player.vel.y = 0;
  player.grounded = false;
  player.facing = 1;
  player.active = active;
  score = 0;
  Camera.snap();
}

function updateWorld(): void {
  const remotes = [...ghosts].filter((ghost) => ghost.active);
  const run = input.axis("left", "right"); // [#8]
  // The window/cooldown timers are clock-derived (no tick) — they read
  // Clock.world, so nothing to advance here.
  const dashing = dashActive.active;
  if (dashing) {
    // A dash owns the velocity: fixed speed, gravity suspended, trail.
    player.vel.x = player.facing * DASH_SPEED;
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
  const dropping = input.down.down && input.jump.pressed && Collision.dropThrough(player, level);
  if (dropping) {
    gate.coyote.expire();
  } else if (gate.try(input.jump.pressed, player.grounded)) {
    player.vel.y = JUMP;
    sfx.jump.play(); // [#36]
  } else if (input.jump.pressed && !player.grounded && wallCoyote.active) {
    player.vel.y = JUMP * 0.9;
    player.vel.x = -wallDir * WALL_JUMP_X;
    player.facing = -wallDir;
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
    if (run !== 0) player.facing = Math.sign(run);
    dashActive.charge();
    dashCooldown.use();
    sfx.dash.play();
    Camera.shake(2, 100); // [#29]
  }

  if (dashing && bumpCooldown.ready()) {
    const other = remotes.find((g) => Collision.sweptAABB(player, player.vel.x, player.vel.y, g));
    if (other) {
      gameEvents.emit("bump", {
        target: other.id,
        vx: player.facing * DASH_SPEED * 0.7,
        vy: -4,
      });
      bumpCooldown.use();
    }
  }

  // [#14]/[#40] Policy path against the tilemap: grid broadphase for free.
  const hit = Collision.moveAndSlide(player, remotes.length ? [level, ...remotes] : level);
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

  for (const coin of coins) if (Collision.circleRect(coin.x, coin.y, 10, player)) coins.take(coin);

  if (run !== 0 && !dashing) player.facing = Math.sign(run);
  playerAnimation.set(
    dashing ? "dash" : !player.grounded ? "jump" : Math.abs(player.vel.x) > 0.5 ? "run" : "idle",
  ); // [#25]

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

const animationState = (body: { grounded?: boolean; vx: number }) =>
  Math.abs(body.vx) > MOVE + 1
    ? "dash"
    : !body.grounded
      ? "jump"
      : Math.abs(body.vx) > 0.5
        ? "run"
        : "idle";

function playerIndex(id: string): number {
  return [room.id, ...room.peers].sort().indexOf(id) + 1;
}

function drawPlayerLabel(
  id: string,
  body: { x: number; y: number; w?: number; h?: number; color?: string },
): void {
  UI.worldLabel(`P${playerIndex(id)}`, body, {
    offset: { y: -(body.h ?? 32) / 2 - 20 },
    margin: 32,
    bold: true,
    size: 11,
    color: body.color,
  });
}

function drawPlayerLabels(remotes: Iterable<Net.BodySnapshot & { id: string }>): void {
  if (player.active) drawPlayerLabel(room.id, player);
  for (const remote of remotes) drawPlayerLabel(remote.id, remote);
}

type RemotePlayer = Net.BodySnapshot & {
  id: string;
  w: number;
  h: number;
  color: string;
  facing: number;
};

function drawStage(remotes: readonly RemotePlayer[]): void {
  // [#16] Screen space is the default; the camera transforms its block.
  Camera.render(() => {
    Draw.tiles(level, skin); // [#42] data never draws itself
    for (const platform of platforms)
      Draw.rect(platform.x, platform.y, platform.w, platform.h, "#31555a");
    for (const coin of coins) Draw.circle(coin, 8, "#ffd166"); // [#21]
    for (const g of remotes) {
      let animation = ghostAnimations.get(g.id);
      if (!animation) ghostAnimations.set(g.id, (animation = heroAnimation(g.color)));
      animation.set(animationState(g));
      animation.look(g.vx, g.vy, g.facing);
      Draw.sprite(animation, g, { flipX: g.facing < 0, alpha: 0.65 }); // [#49]
    }
    if (player.active) {
      playerAnimation.look(player.vel.x, player.vel.y, player.facing);
      Draw.sprite(playerAnimation, player, { flipX: player.facing < 0, scaleY: squash.value }); // [#26]
    }
    Draw.particles(fx); // [#28]
  });
}

function drawHud(remotes: readonly RemotePlayer[]): void {
  drawPlayerLabels(remotes);
  UI.text(`Coins: ${score}`, { x: 10, y: 8, color: "#888" }); // [#6]
}

function drawFeature(name: string, description: string): void {
  UI.col({ gap: 2 }, () => {
    UI.text(name, { color: "accent", bold: true, size: 11 });
    UI.text(description, { color: "dim", size: 12, wrap: true });
  });
}

function resumeGame(): void {
  input.consume("jump"); // A belongs to the modal until released
  scenes.pop();
}

function drawPauseMenu(): void {
  // `playing` re-draws beneath us (non-opaque stack) — frozen mid-air.
  UI.modal(
    {
      w: 280,
      title: "PAUSED",
      pad: 16,
      gap: 10,
      id: "pause",
      onDismiss: resumeGame,
    },
    () => {
      if (UI.button("Resume", { id: "resume" })) resumeGame();
      Audio.buses.music.volume = UI.slider("Music", Audio.buses.music.volume, {
        id: "music",
      }); // [#43]
      Audio.buses.sfx.volume = UI.slider("Sfx", Audio.buses.sfx.volume, { id: "sfx" });
    },
  );
}

const titleScene: SceneSpec = {
  enter() {
    resetLevel(false);
  },
  draw() {
    const remotes = [...ghosts].filter((ghost) => ghost.active);
    drawStage(remotes);
    drawHud(remotes);
    UI.modal(
      { w: 540, title: "API LAB · MULTIPLAYER PLAYGROUND", id: "intro", gap: 7, pad: 14 },
      () => {
        UI.text("You joined as a spectator. Watch the live room, then jump in whenever you like.", {
          size: 13,
          wrap: true,
        });
        UI.col(
          {
            h: UI.vh(50, { min: 120, max: 220 }),
            gap: 8,
            overflow: "auto",
            id: "features",
          },
          () => {
            drawFeature(
              "MOVEMENT",
              "Run, variable jump, coyote time, jump buffering, wall slide/jump, air dash, and down+jump through one-way platforms.",
            );
            drawFeature(
              "MULTIPLAYER",
              "Unique colors, synchronized animations, indexed player labels, off-screen indicators, spawn slots, player collision, standing on players, and dash bumps.",
            );
            drawFeature(
              "SHARED WORLD + NETCODE",
              "Host-validated coins hide instantly, play predicted pickup effects, sync to everyone, and respawn after 4 seconds. Typed events, host migration, 60 Hz player snapshots, bounded extrapolation, adaptive jitter buffering, network time, and RTT are built in.",
            );
            drawFeature(
              "ENGINE",
              "Responsive canvas, ASCII tilemaps, swept collision, scenes/pause and audio settings, camera, particles, animation, synth audio, storage, immediate UI, and a virtual gamepad.",
            );
            drawFeature(
              "FALLBACK",
              "If the relay is unavailable, a local one-player room keeps the exact same multiplayer code running offline.",
            );
          },
        );
        UI.text(
          room.local
            ? "No relay found: local fallback is active. The same multiplayer code keeps working offline."
            : `${room.peerCount + 1} connected · ${room.hosting ? "You are the host" : "Host is online"} · ${Math.round(netTime.rttMs)} ms RTT`,
          { color: "dim", size: 12, wrap: true },
        );
        if (UI.button({ id: "play", label: "PLAY", variant: "primary", h: 36 }))
          scenes.go("playing");
      },
    );
  },
};

const playingScene: SceneSpec = {
  enter: resetLevel,
  update() {
    if (input.pause.pressed) return scenes.push("paused");
    updateWorld();
  },
  draw() {
    const remotes = [...ghosts].filter((ghost) => ghost.active);
    drawStage(remotes);
    drawHud(remotes);
    OnscreenInput.drawControls(pad); // painted at end-of-frame
  },
};

const pausedScene: SceneSpec = {
  // [#31] push held Clock.world — the world below is frozen mid-air.
  exit() {
    Storage.save("api-lab:audio", {
      music: Audio.buses.music.volume,
      sfx: Audio.buses.sfx.volume,
    });
  },
  update() {
    if (input.pause.pressed) scenes.pop();
  },
  draw: drawPauseMenu,
};

// [#31] Typed scenes; the stack is a draw order AND a time boundary.
const scenes = Scenes.create({
  title: titleScene,
  playing: playingScene,
  paused: pausedScene,
});

Loop.run(scenes); // [#31] the stack IS the callbacks, structurally
