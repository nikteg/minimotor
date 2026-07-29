// API Lab — one small game exercising the public API. [#n] references
// API-REVIEW.md.
import {
  Anim,
  Assets,
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
  Sprites,
  App,
  Storage,
  Tiles,
  Timers,
  UI,
  type SceneSpec,
} from "minimotor";
import type { GameProtocol } from "./protocol.js";

// [#1]/[#3] Live viewport, engine-owned background.
App.init("game", { background: "#222" });

const HERO_SHEET = {
  frame: { w: 33, h: 32 },
  states: {
    idle: { row: 0, frames: 4, fps: 6 },
    run: { row: 1, frames: 6, fps: 12 },
    climb: { row: 2, frames: 4, fps: 8 },
    jump: { row: 5, frames: 2, fps: 8 },
    dash: { row: 9, frames: 4, fps: 20 },
  },
} as const;

// [#2]/[#25] Real CC0 sprite sheets, loaded once and then used synchronously.
const art = await Assets.load({
  background: new URL("./assets/sunnyland-background.png", import.meta.url).href,
  terrain: new URL("./assets/sunnyland-tileset.png", import.meta.url).href,
  hero: {
    src: new URL("./assets/foxy.png", import.meta.url).href,
    sheet: HERO_SHEET,
  },
  gem: {
    src: new URL("./assets/gem.png", import.meta.url).href,
    sheet: {
      frame: { w: 15, h: 13 },
      states: { spin: { row: 0, frames: 5, fps: 10 } },
    },
  },
  pickup: {
    src: new URL("./assets/item-feedback.png", import.meta.url).href,
    sheet: {
      frame: { w: 40, h: 32 },
      states: { burst: { row: 0, frames: 4, fps: 16, loop: false } },
    },
  },
  death: {
    src: new URL("./assets/death.png", import.meta.url).href,
    sheet: {
      frame: { w: 40, h: 41 },
      states: { die: { row: 0, frames: 6, fps: 12, loop: false } },
    },
  },
});

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
    up: ["ArrowUp", "KeyW", "pad:dpad-up", "pad:lstick-up"],
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
const CLIMB_SPEED = 3;

// [#39] The level IS the source file: ASCII grid + semantics-only legend.
const level = Tiles.grid(
  `
................................................
................................................
.....g......................g...................
....====...............g........................
......................====......................
............................H...................
........g...............====H===................
.......====.................H...................
............................H...........g.......
...............g............H..........====.....
..............====..........H...................
..................R.........H...................
..P.........................H...................
##########....##################....############
`,
  {
    size: 32,
    legend: {
      "#": { solid: true },
      "=": { solid: true, oneWay: true }, // [#13]
      H: { ladder: true },
    },
  },
);

const terrain = Tiles.set(art.terrain, {
  size: 16,
  names: {
    grass: [1, 1],
    platform: [9, 1],
    ladder: [7, 10],
  },
});

// [#41] Presentation is a SKIN, applied at the draw site; `satisfies` checks
//       completeness against the legend.
const skin = {
  "#": terrain.grass,
  "=": terrain.platform,
  H: terrain.ladder,
} satisfies Tiles.Skin<typeof level>;

// The sheet's grassy slope is a 48×32 region. Its collision is the same plain
// rect plus one semantic field; moveAndSlide handles the diagonal top.
const slopes = level.spawns("R").map((marker) => ({
  x: marker.x - 48,
  y: marker.y - 16,
  w: 96,
  h: 64,
  slope: "up-right" as const,
}));
const slopeSprites = slopes.map((slope) => ({
  img: art.terrain,
  x: slope.x,
  y: slope.y,
  w: slope.w,
  h: slope.h,
  ax: 0,
  ay: 0,
  sx: 304,
  sy: 16,
  sw: 48,
  sh: 32,
}));

// [#35]-[#38] Synth sfx on the default buses; recipes are tweakable specs.
const sfx = Audio.sfx({
  jump: { shape: "square", freq: { from: 520, to: 880 }, ms: 90, volume: 0.4 },
  gem: Audio.Recipes.coin(), // [#36]
  dash: Audio.Recipes.whoosh(),
  death: {
    shape: "sawtooth",
    freq: { from: 240, to: 45 },
    ms: 420,
    volume: 0.55,
    filter: { type: "lowpass", freq: { from: 1200, to: 120 } },
  },
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

function heroAnimation(color: string) {
  const sprite = art.hero.play("idle");
  const outline = Anim.sheet(
    Sprites.tint(art.hero.image as HTMLImageElement, color),
    HERO_SHEET,
  ).play("idle");
  return {
    sprite,
    outline,
    set(state: "idle" | "run" | "jump" | "dash" | "climb") {
      sprite.set(state);
      outline.set(state);
    },
  };
}

const PLAYER_COLOR = "#4ecdc4";
const colorFor = (index: number) => `hsl(${(index * 137.508 + 320) % 360} 90% 65%)`;

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
const deathActive = Timers.window(850);
let wallDir = 0; // -1 = wall on our left, +1 = on our right
let canAirDash = true;
let climbing = false;
const fx = Particles.create(); // [#28]
const gemAnimation = art.gem.play("spin");
const deathAnimation = art.death.play("die");
const pickupEffects: {
  x: number;
  y: number;
  animation: ReturnType<typeof art.pickup.play>;
}[] = [];

const gemSpawns = level.spawns("g");
let score = 0;

// [#9]/[#12]/[#14] Vec2 + Rect + MoverBody in one plain object.
const start = level.spawnOne("P");
const player = {
  x: start.x - 11,
  y: start.y - 14,
  w: 22,
  h: 28,
  vel: { x: 0, y: 0 },
  grounded: false,
  facing: 1,
  color: PLAYER_COLOR,
  active: false,
  state: "idle",
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
const gems = Net.sharedItems(room, gemSpawns, {
  channel: "gems",
  respawnMs: 4000,
  now: () => netTime.now,
  canTake(gem, by) {
    const collector = by === room.id ? player : ghosts.latest(by);
    return (
      !!collector?.active &&
      collector.state !== "death" &&
      !!Collision.circleRect(gem.x, gem.y, 24, collector)
    );
  },
  onTake(_gem, by) {
    if (by === room.id) score++;
  },
  onEffect(gem) {
    pickupEffects.push({
      x: gem.x,
      y: gem.y,
      animation: art.pickup.play("burst"),
    });
    fx.burst({
      at: gem,
      count: 12,
      speed: [1, 3],
      life: [200, 400],
      size: [1, 3],
      color: "#ffd166",
    });
    sfx.gem.play({ pitch: [0.95, 1.15] });
  },
});

gameEvents.on("bump", ({ target, vx, vy }) => {
  if (target !== room.id || player.state === "death") return;
  player.vel.x = vx;
  player.vel.y = vy;
  dashActive.expire();
  Camera.shake(3, 120);
});

gameEvents.on("death", ({ x, y }) => {
  sfx.death.play({ pitch: [0.9, 1.1] });
  fx.burst({
    at: { x, y },
    count: 16,
    speed: [1, 4],
    life: [250, 500],
    size: [2, 4],
    color: "#ff8a5b",
  });
});

gameEvents.on("respawn", (_data, from) => ghosts.reset(from));

function respawn(active = true, notify = false): void {
  player.x = start.x - player.w / 2 + Net.memberIndex(room) * 28;
  player.y = start.y - player.h / 2;
  player.vel.x = 0;
  player.vel.y = 0;
  player.grounded = false;
  player.facing = 1;
  player.active = active;
  player.state = "idle";
  climbing = false;
  deathAnimation.reset();
  Camera.snap();
  if (notify) gameEvents.emit("respawn", {});
}

function resetLevel(active = true): void {
  respawn(active);
  score = 0;
}

function killPlayer(): void {
  if (player.state === "death") return;
  player.state = "death";
  // Keep the death sheet just inside the camera after the body fell away.
  player.y = Math.min(player.y, level.rect.h - player.h / 2);
  player.vel.x = player.vel.y = 0;
  player.grounded = false;
  climbing = false;
  dashActive.expire();
  deathActive.charge();
  deathAnimation.reset();
  sfx.death.play();
  fx.burst({
    at: { x: player.x + player.w / 2, y: player.y + player.h / 2 },
    count: 16,
    speed: [1, 4],
    life: [250, 500],
    size: [2, 4],
    color: "#ff8a5b",
  });
  gameEvents.emit("death", {
    x: player.x + player.w / 2,
    y: player.y + player.h / 2,
  });
  Camera.shake(5, 250);
}

function updateWorld(): void {
  if (player.state === "death") {
    if (!deathActive.active) respawn(true, true);
    return;
  }

  const remotes = [...ghosts].filter((ghost) => ghost.active);
  const collidableRemotes = remotes.filter((ghost) => ghost.state !== "death");
  const run = input.axis("left", "right"); // [#8]
  const climbAxis = input.axis("up", "down");

  // [#14] The level itself is the ladder source. One helper handles entering,
  // staying attached, centering, and vertical velocity.
  const ladderJump = climbing && input.jump.pressed && !input.up.down;
  if (ladderJump) {
    climbing = false;
    player.vel.y = JUMP * 0.85;
    sfx.jump.play({ pitch: 1.15 });
  } else {
    climbing = Collision.climbLadder(player, level, climbAxis, {
      active: climbing,
      speed: CLIMB_SPEED,
    });
  }

  // The window/cooldown timers are clock-derived (no tick) — they read
  // Clock.world, so nothing to advance here.
  const dashing = dashActive.active && !climbing;
  if (climbing) {
    dashActive.expire();
    player.vel.x = Mathf.approach(player.vel.x, 0, ACCEL * 2);
    if (climbAxis > 0) Collision.dropThrough(player, level);
  } else if (dashing) {
    // A dash owns the velocity: fixed speed, gravity suspended, trail.
    player.vel.x = player.facing * DASH_SPEED;
    player.vel.y = 0;
    fx.emit({
      at: { x: player.x + player.w / 2, y: player.y + player.h / 2 },
      speed: [0.1, 0.6],
      life: [120, 260],
      size: [2, 4],
      color: player.color,
    });
  } else {
    player.vel.x = Mathf.approach(player.vel.x, run * MOVE, ACCEL);
    player.vel.y += GRAVITY;
  }

  // Ground jump (coyote + buffer via the gate), else wall jump (its own
  // coyote window charged by recent wall contact).
  const dropping =
    !climbing && input.down.down && input.jump.pressed && Collision.dropThrough(player, level);
  if (dropping) {
    gate.coyote.expire();
  } else if (!climbing && !ladderJump && gate.try(input.jump.pressed, player.grounded)) {
    player.vel.y = JUMP;
    sfx.jump.play(); // [#36]
  } else if (
    !climbing &&
    !ladderJump &&
    input.jump.pressed &&
    !player.grounded &&
    wallCoyote.active
  ) {
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
      color: player.color,
    });
  }
  if (input.jump.released && player.vel.y < 0 && !dashing && !climbing) player.vel.y *= JUMP_CUTOFF;

  // Dash: on the edge, off cooldown, once per airtime (refreshes on landing).
  if (!climbing && input.dash.pressed && dashCooldown.ready() && (player.grounded || canAirDash)) {
    if (!player.grounded) canAirDash = false;
    if (run !== 0) player.facing = Math.sign(run);
    dashActive.charge();
    dashCooldown.use();
    sfx.dash.play();
    Camera.shake(2, 100); // [#29]
  }

  if (dashing && bumpCooldown.ready()) {
    const other = collidableRemotes.find((g) =>
      Collision.sweptAABB(player, player.vel.x, player.vel.y, g),
    );
    if (other) {
      gameEvents.emit("bump", {
        target: other.id,
        vx: player.facing * DASH_SPEED * 0.7,
        vy: -4,
      });
      bumpCooldown.use();
    }
  }

  // [#14]/[#40] One policy call handles tiles, diagonal slopes, and players.
  const worldSolids = [level, ...slopes, ...collidableRemotes];
  const hit = Collision.moveAndSlide(player, worldSolids);
  player.x = Math.max(0, Math.min(player.x, level.rect.w - player.w));
  player.y = Math.max(0, player.y); // no bottom clamp: falling out is meaningful

  if (player.y > level.rect.h + 40) {
    killPlayer();
    return;
  }

  // Wall state (from this step's contacts): recent touch charges the wall
  // coyote; pressing into the wall while falling becomes a wall slide.
  if (!player.grounded && !climbing && (hit.left || hit.right)) {
    wallDir = hit.left ? -1 : 1;
    wallCoyote.charge();
    dashActive.expire(); // dashing into a wall ends the dash
    if (run === wallDir && player.vel.y > WALL_SLIDE) player.vel.y = WALL_SLIDE;
  }
  if (player.grounded) canAirDash = true;

  for (const gem of gems) if (Collision.circleRect(gem.x, gem.y, 12, player)) gems.take(gem);

  if (run !== 0 && !dashing && !climbing) player.facing = Math.sign(run);
  player.state = climbing
    ? "climb"
    : dashing
      ? "dash"
      : !player.grounded
        ? "jump"
        : Math.abs(player.vel.x) > 0.5
          ? "run"
          : "idle";
  playerAnimation.set(player.state as HeroState); // [#25]

  if (player.grounded && !wasGrounded) {
    squash = Anim.animate({ from: 0.8, to: 1, ms: 120, ease: Mathf.easeOut }); // [#27]
    fx.burst({
      at: { x: player.x + player.w / 2, y: player.y + player.h },
      count: 8,
      speed: [0.5, 2],
      life: [150, 300],
      size: [1, 2],
      color: "#d59b63",
    });
    if (hit.impact > 8) {
      Camera.shake(Mathf.remap(hit.impact, 8, 16, 1, 5), 150); // [#29]
      sfx.thud.play();
    }
  }
  wasGrounded = player.grounded;
}

type HeroState = "idle" | "run" | "jump" | "dash" | "climb";

const animationState = (body: { state?: string; grounded?: boolean; vx: number }): HeroState =>
  body.state === "climb"
    ? "climb"
    : body.state === "dash" || Math.abs(body.vx) > MOVE + 1
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

const ghostDeaths = new Map<string, ReturnType<typeof art.death.play>>();
const ghostStates = new Map<string, string | undefined>();

function drawHero(
  animation: ReturnType<typeof heroAnimation>,
  body: { x: number; y: number; w: number; h: number; facing: number },
  alpha = 1,
  scaleY = 1,
): void {
  const at = {
    x: body.x + (body.w - 33) / 2,
    y: body.y + body.h - 32,
    w: 33,
    h: 32,
  };
  Draw.sprite(animation.outline, at, {
    flipX: body.facing < 0,
    scaleX: 1.12,
    scaleY: 1.12 * scaleY,
    alpha,
  });
  Draw.sprite(animation.sprite, at, { flipX: body.facing < 0, scaleY, alpha });
}

function drawDeath(
  animation: ReturnType<typeof art.death.play>,
  body: { x: number; y: number; w: number; h: number },
  alpha = 1,
): void {
  Draw.sprite(
    animation,
    {
      x: body.x + body.w / 2 - 20,
      y: body.y + body.h - 41,
      w: 40,
      h: 41,
    },
    { alpha },
  );
}

function drawPlayerColor(body: { x: number; y: number; w: number; color: string }): void {
  Draw.rect(body.x + body.w / 2 - 4, body.y - 4, 8, 3, body.color);
}

function drawStage(remotes: readonly RemotePlayer[]): void {
  // [#16] Screen space is the default; the camera transforms its block.
  Camera.render(() => {
    for (let x = 0; x < level.rect.w; x += 768) Draw.image(art.background, x, 0, 768, 480);
    Draw.tiles(level, skin); // [#42] data never draws itself
    Draw.sprites(slopeSprites);
    for (const gem of gems)
      Draw.sprite(gemAnimation, { x: gem.x - 15, y: gem.y - 13, w: 30, h: 26 }); // [#21]
    for (let i = pickupEffects.length - 1; i >= 0; i--) {
      const effect = pickupEffects[i];
      Draw.sprite(effect.animation, {
        x: effect.x - 20,
        y: effect.y - 16,
        w: 40,
        h: 32,
      });
      if (effect.animation.done) pickupEffects.splice(i, 1);
    }
    for (const g of remotes) {
      const previous = ghostStates.get(g.id);
      ghostStates.set(g.id, g.state);
      if (g.state === "death") {
        let death = ghostDeaths.get(g.id);
        if (!death) ghostDeaths.set(g.id, (death = art.death.play("die")));
        if (previous !== "death") death.reset();
        drawDeath(death, g, 0.75);
      } else {
        let animation = ghostAnimations.get(g.id);
        if (!animation) ghostAnimations.set(g.id, (animation = heroAnimation(g.color)));
        animation.set(animationState(g));
        drawHero(animation, g, 0.7);
      }
      drawPlayerColor(g);
    }
    if (player.active) {
      if (player.state === "death") drawDeath(deathAnimation, player);
      else drawHero(playerAnimation, player, 1, squash.value); // [#26]
      drawPlayerColor(player);
    }
    Draw.particles(fx); // [#28]
  });
}

function drawHud(remotes: readonly RemotePlayer[]): void {
  drawPlayerLabels(remotes);
  UI.text(`Gems: ${score}`, { x: 10, y: 8, color: "#888" }); // [#6]
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
              "Run, variable jump, coyote time, jump buffering, wall slide/jump, air dash, one-way platforms, smooth slopes, ladders, and fall-out death/respawn.",
            );
            drawFeature(
              "MULTIPLAYER",
              "Unique colors, synchronized animations, indexed player labels, off-screen indicators, spawn slots, player collision, standing on players, and dash bumps.",
            );
            drawFeature(
              "SHARED WORLD + NETCODE",
              "Host-validated gems hide instantly, play predicted sheet effects, sync to everyone, and respawn after 4 seconds. Movement, climbing, death states, sounds, typed events, host migration, 60 Hz snapshots, extrapolation, adaptive jitter buffering, network time, and RTT are built in.",
            );
            drawFeature(
              "ENGINE",
              "Responsive canvas, Sunny Land tiles and sprite sheets, semantic ASCII levels, swept/slope collision, ladder movement, scenes, camera, particles, animation, synth audio, storage, immediate UI, perf graphs, and a virtual gamepad.",
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
