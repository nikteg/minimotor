// API Lab — one small game exercising the public API. [#n] references
// API-REVIEW.md.
import { Collision, Mathf, Tiles, createApp } from "minimotor";
import type { BodyState, Shared } from "minimotor/net";
import * as Sprites from "minimotor/sprites";
import { createAnimation } from "minimotor/animation";
import { createAssets } from "minimotor/assets";
import { createAudio } from "minimotor/audio";
import { createCamera } from "minimotor/camera";
import { createDebug } from "minimotor/debug";
import { createInput } from "minimotor/input";
import { createNet } from "minimotor/net";
import { createOnscreenInput } from "minimotor/onscreen-input";
import { createParticles } from "minimotor/particles";
import * as Platformer from "minimotor/platformer";
import { createPortals } from "minimotor/portals";
import { createScenes, type SceneSpec } from "minimotor/scenes";
import { createBrowserStorage } from "minimotor/storage";
import { createTimers } from "minimotor/timers";
import { createUI } from "minimotor/ui";
import { levelAssets, loadWorld, type LevelId } from "./api-lab.generated.js";
import type { GameProtocol } from "./protocol.js";

// [#1]/[#3] One explicit game owns every stateful capability.
export const game = createApp("game", {
  background: "#222",
});
const { Clock, Draw, Loop } = game;
const Anim = createAnimation(game);
const Assets = createAssets(game);
const Audio = createAudio(game);
export const Camera = createCamera(game);
const Input = createInput(game);
const Net = createNet(game);
const UI = createUI(game, Input);
const OnscreenInput = createOnscreenInput(game, Input, UI);
const Particles = createParticles(game);
const Portals = createPortals(game);
const Scenes = createScenes(game);
const Storage = createBrowserStorage(game);
const Timers = createTimers(game);

// [#2]/[#25] Real CC0 sprite sheets, loaded once and then used synchronously.
const art = await Assets.load({
  ...levelAssets,
  background: new URL("./assets/sunnyland-background.png", import.meta.url).href,
  hero: {
    src: new URL("./assets/foxy.png", import.meta.url).href,
    aseprite: new URL("./assets/foxy.json", import.meta.url).href,
  },
  gem: {
    src: new URL("./assets/gem.png", import.meta.url).href,
    aseprite: new URL("./assets/gem.json", import.meta.url).href,
  },
  pickup: {
    src: new URL("./assets/item-feedback.png", import.meta.url).href,
    aseprite: new URL("./assets/item-feedback.json", import.meta.url).href,
  },
  death: {
    src: new URL("./assets/death.png", import.meta.url).href,
    aseprite: new URL("./assets/death.json", import.meta.url).href,
  },
  tree: new URL("./assets/tree.png", import.meta.url).href,
  bush: new URL("./assets/bush.png", import.meta.url).href,
  sign: new URL("./assets/sign.png", import.meta.url).href,
  woodenHouse: new URL("./assets/wooden-house.png", import.meta.url).href,
  strawHouse: new URL("./assets/straw-house.png", import.meta.url).href,
  pine: new URL("./assets/pine.png", import.meta.url).href,
  palm: new URL("./assets/palm.png", import.meta.url).href,
  rock: new URL("./assets/rock.png", import.meta.url).href,
  bigRock: new URL("./assets/rock-1.png", import.meta.url).href,
  shrooms: new URL("./assets/shrooms.png", import.meta.url).href,
  crate: new URL("./assets/crate.png", import.meta.url).href,
  bigCrate: new URL("./assets/big-crate.png", import.meta.url).href,
});

// On-screen touch gamepad; autohides on desktop, shows on touch.
export const pad = OnscreenInput.gamepad({
  opacity: 0.55,
  stick: { anchor: { side: "left", x: 90, y: 90 }, radius: 60 },
  buttons: [{ anchor: { side: "right", x: 90, y: 90 }, r: 48, button: "a", label: "JUMP" }],
});

// [#8] Named actions over fused devices; zero wiring.
const input = Input.map(
  {
    left: ["ArrowLeft", "KeyA", "pad:dpad-left", "pad:lstick-left"],
    right: ["ArrowRight", "KeyD", "pad:dpad-right", "pad:lstick-right"],
    up: ["ArrowUp", "KeyW", "pad:dpad-up", "pad:lstick-up"],
    down: ["ArrowDown", "KeyS", "pad:dpad-down", "pad:lstick-down"],
    jump: ["ArrowUp", "KeyW", "KeyZ", "pad:a"],
    pause: ["Escape", "pad:start"],
  },
  { pad },
);

// [#5] Per-step units (px/step, px/step²); [#11] feel constants are game data.
const MOVE = 1.5;
const ACCEL = 0.2;
const GRAVITY = 0.25;
const JUMP = -5;
const JUMP_CUTOFF = 0.45;
const WALL_SLIDE = 0.7; // max fall speed while pressing into a wall
const WALL_JUMP_X = 2.25; // horizontal kick away from the wall
const CLIMB_SPEED = 1.5;
const TILE = 16; // Sunny Land's authored grid: one source pixel = one world pixel.
const cameraZoom = () => Math.max(1, game.viewport.h / (18 * TILE));

// One call caches every level's collision, painted tiles, entities, and portals.
const world = loadWorld(art);
let activeArea = world.first;
let level = world.level(activeArea);

// [#35]-[#38] Synth sfx on the default buses; recipes are tweakable specs.
const sfx = Audio.sfx({
  jump: { shape: "square", freq: { from: 520, to: 880 }, ms: 90, volume: 0.4 },
  gem: Audio.Recipes.coin(), // [#36]
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
const audioPrefs = await Storage.load("api-lab:audio", { music: 0.5, sfx: 1.0 });
Audio.buses.music.volume = audioPrefs.music;
Audio.buses.sfx.volume = audioPrefs.sfx;

function heroAnimation(color: string) {
  const sprite = Anim.play(art.hero, "idle");
  const outline = Anim.play(
    art.hero.withImage(Sprites.tint(art.hero.image as HTMLImageElement, color)),
    "idle",
  );
  const animation = Platformer.animations({ sprite, outline });
  return {
    sprite,
    outline,
    sync: animation.sync,
  };
}

const PLAYER_COLOR = "#4ecdc4";

let playerAnimation = heroAnimation(PLAYER_COLOR);
let wasGrounded = false;
let squash = Anim.animate({ from: 1, to: 1, ms: 1 }); // [#27]
let deathSlowmo = Anim.animate({ from: 1, to: 1, ms: 1, clock: Clock.ui });

// [#32] Content: clock-derived, GC is the teardown.
const gate = Timers.jumpGate({ coyoteMs: 100, bufferMs: 120 }); // [#11]
// Wall jumps get their own short coyote window.
const wallCoyote = Timers.window(100);
const deathActive = Timers.window(850);
let wallDir = 0; // -1 = wall on our left, +1 = on our right
let climbing = false;
const fx = Particles.createSystem(); // [#28]
const gemAnimation = Anim.play(art.gem, "spin");
const deathAnimation = Anim.once(art.death, "die");
const pickupEffects = Anim.effects(
  (effect: { x: number; y: number; area: LevelId }) => ({
    ...effect,
    animation: Anim.once(art.pickup, "burst"),
  }),
  (effect) => effect.animation.done,
);

const gemSpawns = world.points("Gem");
let score = 0;

// [#9]/[#12]/[#14] Vec2 + Rect + MoverBody in one plain object.
const PLAYER_W = 12;
const PLAYER_H = 24;
const spawnPosition = (slot: number, area: LevelId) => {
  const start = world.level(area).spawnOne("Player");
  return {
    x: start.x - PLAYER_W / 2 + slot * 28,
    // A marker denotes its cell; align feet to that cell's bottom edge.
    y: start.y + TILE / 2 - PLAYER_H,
  };
};
const player = {
  ...spawnPosition(0, world.first),
  w: PLAYER_W,
  h: PLAYER_H,
  vel: { x: 0, y: 0 },
  grounded: false,
  facing: 1,
  color: PLAYER_COLOR,
  active: false,
  state: "idle",
  area: world.first,
};

// [#15] The game-bound primary camera, configured once.
Camera.follow(player, {
  world: level.rect, // [#39]
  deadzone: { w: 80, h: 50 },
  damping: 0.15,
  zoom: cameraZoom(),
});

// [#48] The room is one call, and `share` is what we put on it — everyone
// else's copy comes back interpolated and ready to draw. If no relay answers,
// the same object is handed back for a solo game: no offline branch to write.
const net = await Net.game<GameProtocol>({ room: "api-lab" });
const players = net.share(player);
player.color = Net.playerColor(net.index);
playerAnimation = heroAnimation(player.color);
const gameEvents = net.events;

/** The other players worth simulating and drawing this frame. */
const livePlayers = (): RemotePlayer[] =>
  [...players].filter((other) => other.active && other.area === player.area);
createDebug(game, {
  camera: Camera,
  world: () => level,
  bodies: () => [player, ...livePlayers()],
  perf: { net: net.meter, layout: "horizontal" },
});

const gems = net.items(gemSpawns, {
  channel: "gems",
  respawnMs: 4000,
  canTake(gem, by) {
    const collector = by === net.id ? player : players.latest(by);
    return (
      !!collector?.active &&
      collector.area === gem.area &&
      collector.state !== "death" &&
      !!Collision.circleRect(gem.x, gem.y, 12, collector)
    );
  },
  onTake(_gem, by) {
    if (by === net.id) score++;
  },
  onEffect(gem) {
    if (gem.area !== player.area) return;
    pickupEffects.play({
      x: gem.x,
      y: gem.y,
      area: gem.area,
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

gameEvents.on("death", ({ x, y, area }) => {
  if (area !== player.area) return;
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

gameEvents.on("respawn", (_data, from) => players.snap(from));

function respawn(active = true, notify = false): void {
  deathSlowmo = Anim.animate({ from: 1, to: 1, ms: 1, clock: Clock.ui });
  Clock.world.scale = 1;
  Object.assign(player, spawnPosition(net.index, player.area));
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
  // UI time drives the curve so slow motion cannot slow its own recovery.
  deathSlowmo = Anim.sequence(
    [
      { from: 0.06, to: 0.06, ms: 50 },
      { from: 0.06, to: 0.25, ms: 130, ease: Mathf.easeOut },
      { from: 0.25, to: 1, ms: 520, ease: Mathf.easeInOut },
    ],
    { clock: Clock.ui },
  );
  Clock.world.scale = deathSlowmo.value;
  player.state = "death";
  // Keep the death sheet just inside the camera after the body fell away.
  player.y = Math.min(player.y, level.rect.h - player.h / 2);
  player.vel.x = player.vel.y = 0;
  player.grounded = false;
  climbing = false;
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
    area: player.area,
  });
  Camera.shake(2.5, 250);
}

function updateWorld(): void {
  Clock.world.scale = deathSlowmo.value;
  if (player.state === "death") {
    if (!deathActive.active) respawn(true, true);
    return;
  }

  const remotes = livePlayers();
  const collidableRemotes = remotes.filter((ghost) => ghost.state !== "death");
  const run = input.axis("left", "right"); // [#8]
  const climbAxis = input.axis("up", "down");

  // [#14] `Tiles.climbable` presents the level's "ladder"-tagged regions as a
  // collision LadderSource. One helper handles entering, staying attached,
  // centering, and vertical velocity.
  const ladderJump = climbing && input.jump.pressed && !input.up.down;
  if (ladderJump) {
    climbing = false;
    player.vel.y = JUMP * 0.85;
    sfx.jump.play({ pitch: 1.15 });
  } else {
    climbing = Collision.climbLadder(player, Tiles.climbable(level), climbAxis, {
      active: climbing,
      autoGrab: true,
      speed: CLIMB_SPEED,
      horizontal: run,
    });
  }

  if (climbing) {
    player.vel.x = Mathf.approach(player.vel.x, 0, ACCEL * 2);
    if (climbAxis > 0) Collision.dropThrough(player, level);
  } else {
    player.vel.x = Mathf.approach(player.vel.x, run * MOVE, ACCEL);
    player.vel.y += GRAVITY;
  }

  // Ground jump (coyote + buffer via the gate), else wall jump (its own
  // coyote window charged by recent wall contact).
  const dropping = !climbing && input.down.down && Collision.dropThrough(player, level);
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
  if (input.jump.released && player.vel.y < 0 && !climbing) player.vel.y *= JUMP_CUTOFF;

  // [#14]/[#40] One policy call handles tiles, diagonal slopes, and players.
  const worldSolids = [level, ...collidableRemotes];
  const hit = Collision.moveAndSlide(player, worldSolids);
  player.x = Math.max(0, Math.min(player.x, level.rect.w - player.w));
  player.y = Math.max(0, player.y); // no bottom clamp: falling out is meaningful

  if (player.y > level.rect.h + 20) {
    killPlayer();
    return;
  }

  // Wall state (from this step's contacts): recent touch charges the wall
  // coyote; pressing into the wall while falling becomes a wall slide.
  if (!player.grounded && !climbing && (hit.left || hit.right)) {
    wallDir = hit.left ? -1 : 1;
    wallCoyote.charge();
    if (run === wallDir && player.vel.y > WALL_SLIDE) player.vel.y = WALL_SLIDE;
  }

  for (const gem of gems)
    if (gem.area === player.area && Collision.circleRect(gem.x, gem.y, 6, player)) gems.take(gem);

  if (run !== 0 && !climbing) player.facing = Math.sign(run);
  player.state = climbing
    ? "climb"
    : !player.grounded
      ? "jump"
      : Math.abs(player.vel.x) > 0.5
        ? "run"
        : "idle";
  playerAnimation.sync(player); // [#25]

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
    if (hit.impact > 8) sfx.thud.play();
  }
  wasGrounded = player.grounded;
}

function drawPlayerLabel(
  id: string,
  body: { x: number; y: number; w?: number; h?: number; color?: string; state?: string },
): void {
  const bodyH = body.h ?? 32;
  const spriteH = body.state === "death" ? 41 : art.hero.frame.h;
  UI.worldLabel(`P${net.indexOf(id) + 1}`, body, {
    camera: Camera,
    offset: { y: bodyH / 2 - spriteH - 8 },
    margin: 32,
    bold: true,
    size: 11,
    color: body.color,
  });
}

function drawPlayerLabels(remotes: Iterable<RemotePlayer>): void {
  if (player.active) drawPlayerLabel(net.id, player);
  for (const remote of remotes) drawPlayerLabel(remote.id, remote);
}

type RemotePlayer = Shared<BodyState<typeof player>>;

const ghostVisuals = Anim.keyed<
  string,
  {
    hero: ReturnType<typeof heroAnimation>;
    death: ReturnType<typeof art.death.play>;
    state?: string;
  }
>();

function drawHero(
  animation: ReturnType<typeof heroAnimation>,
  body: { x: number; y: number; w: number; h: number; facing: number },
  alpha = 1,
  scaleY = 1,
): void {
  const w = animation.sprite.sheet.frame.w;
  const h = animation.sprite.sheet.frame.h;
  const at = {
    x: body.x + (body.w - w) / 2,
    y: body.y + body.h - h,
    w,
    h,
  };
  for (const [x, y] of [
    [-1, -1],
    [0, -1],
    [1, -1],
    [-1, 0],
    [1, 0],
    [-1, 1],
    [0, 1],
    [1, 1],
  ])
    Draw.sprite(
      animation.outline,
      { ...at, x: at.x + x, y: at.y + y },
      {
        flipX: body.facing < 0,
        scaleY,
        alpha,
      },
    );
  Draw.sprite(animation.sprite, at, { flipX: body.facing < 0, scaleY, alpha });
}

function drawDeath(
  animation: ReturnType<typeof art.death.play>,
  body: { x: number; y: number; w: number; h: number },
  alpha = 1,
): void {
  const w = animation.sheet.frame.w;
  const h = animation.sheet.frame.h;
  Draw.sprite(
    animation,
    {
      x: body.x + (body.w - w) / 2,
      y: body.y + body.h - h,
      w,
      h,
    },
    { alpha },
  );
}

function drawBackground(view: { x: number; y: number; w: number; h: number }): void {
  // The source is one authored 384×240 scene, not a repeating texture. Crop
  // it like `object-fit: cover` so every viewport is filled without stretching
  // or inventing seams.
  const iw = art.background.width;
  const ih = art.background.height;
  const sourceAspect = iw / ih;
  const viewAspect = view.w / view.h;
  const sw = viewAspect < sourceAspect ? ih * viewAspect : iw;
  const sh = viewAspect < sourceAspect ? ih : iw / viewAspect;
  Draw.sprites([
    {
      img: art.background,
      x: view.x,
      y: view.y,
      w: view.w,
      h: view.h,
      ax: 0,
      ay: 0,
      sx: (iw - sw) / 2,
      sy: (ih - sh) / 2,
      sw,
      sh,
    },
  ]);

  // Terrain is a connected mass with rooms carved from it. One cave field
  // behind that mass covers every opening; no per-room overlap patches.
  const caveRow = world.fields(activeArea).CaveRow;
  if (caveRow !== null) {
    const caveY = caveRow * TILE;
    Draw.rect(0, caveY, level.rect.w, level.rect.h - caveY, "#29263e");
  }
}

function drawStage(remotes: readonly RemotePlayer[]): void {
  Camera.zoom = cameraZoom();
  // [#16] Screen space is the default; the camera transforms its block.
  Camera.render(() => {
    const view = Camera.rect;
    drawBackground(view);
    Draw.sprites(world.sprites(activeArea, art));
    Draw.tiles(world.tiles(activeArea));
    for (const portal of world.portals(activeArea)) {
      Draw.rect(portal.x + 3, portal.y + 2, portal.w - 6, portal.h - 2, "rgba(199,125,255,.35)");
      Draw.rect(portal.x + 6, portal.y + 6, portal.w - 12, portal.h - 8, "#c77dff");
    }
    const gemW = gemAnimation.sheet.frame.w;
    const gemH = gemAnimation.sheet.frame.h;
    for (const gem of gems) {
      if (gem.area !== player.area) continue;
      Draw.sprite(gemAnimation, {
        x: gem.x - gemW / 2,
        y: gem.y - gemH / 2,
        w: gemW,
        h: gemH,
      }); // [#21]
    }
    for (const effect of pickupEffects) {
      if (effect.area !== player.area) continue;
      const w = effect.animation.sheet.frame.w;
      const h = effect.animation.sheet.frame.h;
      Draw.sprite(effect.animation, {
        x: effect.x - w / 2,
        y: effect.y - h / 2,
        w,
        h,
      });
    }
    for (const g of remotes) {
      const visual = ghostVisuals.get(g.id, () => ({
        hero: heroAnimation(g.color),
        death: Anim.once(art.death, "die"),
        state: undefined,
      }));
      const previous = visual.state;
      visual.state = g.state;
      if (g.state === "death") {
        if (previous !== "death") visual.death.reset();
        drawDeath(visual.death, g, 0.75);
      } else {
        visual.hero.sync(g);
        drawHero(visual.hero, g, 0.7);
      }
    }
    ghostVisuals.retain(remotes.map((remote) => remote.id));
    if (player.active) {
      if (player.state === "death") drawDeath(deathAnimation, player);
      else drawHero(playerAnimation, player, 1, squash.value); // [#26]
    }
    Draw.particles(fx); // [#28]
  });
}

function drawMinimap(remotes: readonly RemotePlayer[]): void {
  UI.panel(
    {
      anchor: "topLeft",
      x: 8,
      y: 28,
      w: 240,
      h: 96,
      pad: 4,
      bg: "rgba(20, 25, 45, .86)",
      border: "#665b86",
    },
    (layout) => {
      const caveRow = world.fields(activeArea).CaveRow;
      UI.minimap(level, {
        at: layout.next(232, 88),
        view: Camera.rect,
        tile: ({ row, spec }) =>
          spec.tags?.includes(Tiles.LADDER)
            ? "#e8b56a"
            : spec.oneWay
              ? "#d59b63"
              : caveRow === null || row < caveRow
                ? "#805064"
                : "#493c58",
        points: [
          ...[...gems]
            .filter((gem) => gem.area === player.area)
            .map((gem) => ({ ...gem, color: "#e996ff", size: 2 })),
          ...remotes.map((remote) => ({
            x: remote.x + remote.w / 2,
            y: remote.y + remote.h / 2,
            color: remote.color,
            size: 5,
          })),
          ...(player.active
            ? [
                {
                  x: player.x + player.w / 2,
                  y: player.y + player.h / 2,
                  color: player.color,
                  size: 5,
                  outline: "#fff",
                },
              ]
            : []),
        ],
      });
    },
  );
}

function drawHud(remotes: readonly RemotePlayer[]): void {
  drawPlayerLabels(remotes);
  drawMinimap(remotes);
  UI.text(`Gems: ${score}`, { x: 10, y: 8, color: "#888" }); // [#6]
  UI.text(world.fields(activeArea).DisplayName, {
    anchor: "top",
    y: 8,
    color: "dim",
    size: 11,
  });
}

function drawFeature(name: string, description: string): void {
  UI.col({ gap: 2 }, () => {
    UI.text(name, { color: "accent", bold: true, size: 11 });
    UI.text(description, { color: "dim", size: 12, wrap: true });
  });
}

function resumeGame(): void {
  // Modal keys/buttons belong to the modal until released. In particular,
  // Escape may dismiss during draw before the next fixed update sees it.
  input.consume("jump");
  input.consume("pause");
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

function enterArea(area: LevelId): void {
  activeArea = area;
  level = world.level(area);
  player.area = area;
  climbing = false;
  pickupEffects.clear();
  fx.clear();
  Camera.follow(player, {
    world: level.rect,
    deadzone: { w: 80, h: 50 },
    damping: 0.15,
    zoom: cameraZoom(),
  });
  Camera.snap();
}

const titleScene: SceneSpec = {
  enter() {
    enterArea(world.first);
    resetLevel(false);
  },
  draw() {
    const remotes = livePlayers();
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
              "Run, variable jump, coyote time, jump buffering, wall slide/jump, one-way platforms, smooth slopes, auto-grab ladders, and fall-out death/respawn.",
            );
            drawFeature(
              "MULTIPLAYER",
              "Unique colors, synchronized animations and level travel, indexed player labels, off-screen indicators, spawn slots, player collision, and standing on players.",
            );
            drawFeature(
              "SHARED WORLD + NETCODE",
              "Host-validated gems hide instantly, play predicted sheet effects, sync to everyone, and respawn after 4 seconds. Movement, climbing, death states, sounds, typed events, host migration, 60 Hz snapshots, extrapolation, adaptive jitter buffering, network time, and RTT are built in.",
            );
            drawFeature(
              "ENGINE",
              "Three LDtk-authored levels with direct tile layers, scenery, typed entities, and networked portals (the same world features also work with tile strings), responsive canvas, shallow/steep slopes, ladders, scenes, camera, particles, animation, synth audio, storage, immediate UI, perf graphs, and a virtual gamepad.",
            );
            drawFeature(
              "DEBUG",
              "Press ? (Shift+Plus on a Swedish keyboard) to cycle from a clean screen, to performance graphs, to performance plus collision meshes.",
            );
            drawFeature(
              "FALLBACK",
              "If the relay is unavailable, a local one-player room keeps the exact same multiplayer code running offline.",
            );
          },
        );
        UI.text(
          net.online
            ? `${net.count} connected · ${net.hosting ? "You are the host" : "Host is online"} · ${Math.round(net.rttMs)} ms RTT`
            : "No relay found: solo fallback is active. The same multiplayer code keeps working offline.",
          { color: "dim", size: 12, wrap: true },
        );
        if (UI.button({ id: "play", label: "PLAY", variant: "primary", h: 36 })) {
          respawn(true);
          scenes.go("game");
        }
      },
    );
  },
};

const gameScene: SceneSpec = {
  enter() {
    enterArea(player.area);
  },
  update() {
    if (input.pause.pressed) return scenes.push("paused");
    updateWorld();
  },
  draw() {
    const remotes = livePlayers();
    drawStage(remotes);
    drawHud(remotes);
    OnscreenInput.drawControls(pad); // painted at end-of-frame
  },
};

const pausedScene: SceneSpec = {
  // [#31] push held Clock.world — the world below is frozen mid-air.
  exit() {
    void Storage.save("api-lab:audio", {
      music: Audio.buses.music.volume,
      sfx: Audio.buses.sfx.volume,
    });
  },
  update() {
    if (input.pause.pressed) resumeGame();
  },
  draw: drawPauseMenu,
};

// [#31] Typed scenes; the stack is a draw order AND a time boundary.
const scenes = Scenes.create({
  title: titleScene,
  game: gameScene,
  paused: pausedScene,
});

Portals.create({
  body: player,
  scenes,
  world,
  scene: "game",
});

Loop.run(scenes); // [#31] the stack IS the callbacks, structurally
