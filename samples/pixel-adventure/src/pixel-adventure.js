// PIXEL ADVENTURE: a polished mini-platformer using Pixel Frog's CC0 itch.io
// kit. It demonstrates loaded JSON, named animation states, sprite atlases,
// solid tile collision, a zoomed camera, immediate-mode UI and loaded WAV effects.
// Controls: A/D or arrows move; W, Up or Space jumps; R restarts.
import { Minimotor } from "minimotor";

const GAME_W = 480, GAME_H = 270, TILE = 48;
let vp = Minimotor.Stage.init("game", { plugins: [Minimotor.Perf.plugin()] });
Minimotor.Stage.onResize((next) => (vp = next));
const { Assets, Anim, Fsm, Timers, Tiles, Camera, Collision, Mathf, Input, Keys, Draw, Loop, UI, Particles, Sprites, Game, Audio } =
  Minimotor;
const input = Input.actions({
  left: ["ArrowLeft", "KeyA"], right: ["ArrowRight", "KeyD"], jump: ["ArrowUp", "KeyW", "Space"],
});

// Forgiving jump: coyote grace after running off a ledge + a buffered press
// just before landing. The gate decides *when*; the impulse below is ours.
const jumpGate = Timers.jumpGate({ coyoteMs: 90, bufferMs: 120 });

let ready = false, failed = "", level, map, cam, terrain, backdrop, skyLayer, terrainLayer, playerAnim, enemyAnim, fruitAnim, goalAnim;
let player, playerSm, enemies = [], coins = [], goal, lives = 3, state = "loading", elapsed = 0;

// ---------------------------------------------------------------------------
// Sound — synthesized SFX routed through the engine mixer, replacing the old
// WAV samples. Everything plays on the built-in "sfx" bus (Audio.playSfx),
// which we glue with a master compressor and feed a touch of reverb for air.
// Each preset layers a pitched oscillator with a filtered noise transient so
// hits read clearly and never clip when several stack.
// ---------------------------------------------------------------------------
let mixerReady = false;
function setupMixer() {
  if (mixerReady) return;
  mixerReady = true;
  Audio.Mixer.compressor({ threshold: -14, ratio: 8 }); // stop stacked SFX clipping
  Audio.Mixer.bus("sfx").setVolume(0.8);
  Audio.Mixer.reverb("air", { seconds: 0.6, decay: 2.2, wet: 0.3 });
  Audio.Mixer.bus("sfx").send("air", 0.03); // just a hair of air, not a wash
}
function sfx(build) {
  setupMixer();
  Audio.playSfx(build);
}
function tone(ctx, out, now, { type = "sine", f0, f1, dur, gain, delay = 0 }) {
  const osc = ctx.createOscillator();
  const g = ctx.createGain();
  const t = now + delay;
  osc.type = type;
  osc.frequency.setValueAtTime(f0, t);
  if (f1) osc.frequency.exponentialRampToValueAtTime(f1, t + dur);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(gain, t + 0.008);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  osc.connect(g).connect(out);
  osc.start(t);
  osc.stop(t + dur + 0.03);
}
function noise(ctx, out, now, { type = "bandpass", f0, f1, q = 6, dur, gain, delay = 0 }) {
  const t = now + delay;
  const buf = ctx.createBuffer(1, Math.ceil(ctx.sampleRate * dur), ctx.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  const src = ctx.createBufferSource();
  src.buffer = buf;
  const filt = ctx.createBiquadFilter();
  filt.type = type;
  filt.frequency.setValueAtTime(f0, t);
  filt.Q.value = q;
  if (f1) filt.frequency.exponentialRampToValueAtTime(f1, t + dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(gain, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(filt).connect(g).connect(out);
  src.start(t);
  src.stop(t + dur);
}
const SFX = {
  jump: () =>
    sfx((ctx, now, out) => {
      tone(ctx, out, now, { type: "triangle", f0: 300, f1: 640, dur: 0.13, gain: 0.22 });
      noise(ctx, out, now, { f0: 900, f1: 1800, q: 4, dur: 0.08, gain: 0.05 });
    }),
  coin: () =>
    sfx((ctx, now, out) => {
      [1046, 1318, 1568].forEach((f, i) =>
        tone(ctx, out, now, { type: "sine", f0: f, dur: 0.2, gain: 0.16, delay: i * 0.05 }),
      );
      noise(ctx, out, now, { f0: 3200, q: 9, dur: 0.16, gain: 0.04 });
    }),
  stomp: () =>
    sfx((ctx, now, out) => {
      noise(ctx, out, now, { type: "lowpass", f0: 700, f1: 140, q: 1, dur: 0.14, gain: 0.18 });
      tone(ctx, out, now, { type: "square", f0: 240, f1: 70, dur: 0.13, gain: 0.14 });
    }),
  hurt: () =>
    sfx((ctx, now, out) => {
      tone(ctx, out, now, { type: "sawtooth", f0: 400, f1: 90, dur: 0.3, gain: 0.2 });
      noise(ctx, out, now, { type: "lowpass", f0: 1200, f1: 200, q: 1, dur: 0.28, gain: 0.09 });
    }),
  death: () =>
    sfx((ctx, now, out) => {
      tone(ctx, out, now, { type: "sawtooth", f0: 320, f1: 50, dur: 0.6, gain: 0.22 });
      noise(ctx, out, now, { type: "lowpass", f0: 900, f1: 120, q: 1, dur: 0.5, gain: 0.12 });
    }),
  // Played the moment the last fruit is collected and the goal unlocks — a
  // brighter, fuller major arpeggio than a single pickup so the milestone reads.
  unlock: () =>
    sfx((ctx, now, out) => {
      [659, 831, 988, 1319].forEach((f, i) =>
        tone(ctx, out, now, { type: "triangle", f0: f, dur: 0.28, gain: 0.16, delay: i * 0.07 }),
      );
      noise(ctx, out, now, { f0: 3600, q: 8, dur: 0.4, gain: 0.05, delay: 0.05 });
    }),
  win: () =>
    sfx((ctx, now, out) => {
      [523, 659, 784, 1047].forEach((f, i) =>
        tone(ctx, out, now, { type: "triangle", f0: f, dur: 0.32, gain: 0.18, delay: i * 0.1 }),
      );
    }),
};
function rect(body) { return { x: body.x - body.w / 2, y: body.y - body.h, w: body.w, h: body.h }; }
function solid(body) { return map.solidInRect(rect(body)); }

function drawFlipped(anim, ctx, x, y, facing, opts) {
  ctx.save(); ctx.translate(x, y); ctx.scale(facing, 1); anim.draw(ctx, 0, 0, opts); ctx.restore();
}
function resetRun() {
  state = "play"; lives = 3; elapsed = 0;
  player = { x: 96, y: 10 * TILE, w: 25, h: 35, vx: 0, vy: 0, onGround: false, wall: 0, facing: 1, invuln: 1.25, hurtTimer: 0 };
  coins.forEach((coin) => { coin.got = false; coin.pop = 0; });
  enemies.forEach((enemy, i) => Object.assign(enemy, { x: level.enemies[i][0] * TILE + TILE / 2, y: level.enemies[i][1] * TILE, vx: i % 2 ? -45 : 45, dead: false }));
  cam.snapTo(player.x, player.y - player.h / 2);
}
function respawn() {
  player.x = 96; player.y = 10 * TILE; player.vx = 0; player.vy = 0; player.onGround = false; player.invuln = 1.5;
}
function hurt() {
  if (player.invuln > 0) return;
  lives--; player.invuln = 1.5; player.hurtTimer = 0.35; SFX.hurt();
  Particles.burst(player.x, player.y - 20, { count: 20, colors: ["#ff6b6b", "#ffe066"], speed: [55, 180], life: [280, 700], gravity: 280 });
  UI.floatText("OUCH!", player.x, player.y - 50, { color: "#ff6b6b" });
  if (lives === 0) { state = "gameover"; SFX.death(); } else respawn();
}
function movePlayer(dx, dy) {
  // Sweep the bottom-center-anchored body as a top-left rect against the solid
  // tiles with the engine's kinematic solver, then write the resolved position
  // back and record the contacts (onGround / wall for the wall jump below).
  const hit = map.moveAABB(rect(player), dx, dy);
  player.x = hit.rect.x + player.w / 2;
  player.y = hit.rect.y + player.h;
  if (hit.left || hit.right) player.vx = 0;
  if (hit.top || hit.bottom) player.vy = 0;
  player.onGround = hit.bottom;
  player.wall = hit.left ? -1 : hit.right ? 1 : 0; // side of a wall we're pressing
}

function pixelStar(ctx, x, y, size, color, alpha) {
  ctx.globalAlpha = alpha;
  ctx.fillStyle = color;
  const arm = Math.max(2, Math.round(size * 0.28));
  ctx.fillRect(Math.round(x - arm / 2), Math.round(y - size / 2), arm, size);
  ctx.fillRect(Math.round(x - size / 2), Math.round(y - arm / 2), size, arm);
  ctx.fillStyle = "#fff";
  ctx.fillRect(Math.round(x - arm / 2), Math.round(y - arm / 2), arm, arm);
}

function drawFruitPickup(ctx, coin) {
  const t = Math.min(1, coin.pop / 0.68);
  const burst = 1 - Math.pow(1 - t, 3);
  const fade = Math.max(0, 1 - Math.max(0, t - 0.58) / 0.42);
  const rise = 38 * burst;

  ctx.save();
  ctx.translate(coin.x, coin.y);
  ctx.imageSmoothingEnabled = false;

  // Two crisp expanding diamonds give the pickup a readable silhouette even
  // over the bright terrain, without the old full-height cross obscuring play.
  for (let i = 0; i < 2; i++) {
    const local = Math.max(0, Math.min(1, t * 1.45 - i * 0.18));
    const radius = 9 + local * (25 + i * 8);
    ctx.save();
    ctx.rotate(Math.PI / 4);
    ctx.globalAlpha = (1 - local) * (i ? 0.48 : 0.78);
    ctx.strokeStyle = i ? "#ffad3d" : "#fff3a3";
    ctx.lineWidth = i ? 2 : 3;
    ctx.strokeRect(-radius / 2, -radius / 2, radius, radius);
    ctx.restore();
  }

  // Deterministic radial stars keep the effect stable and properly pixel-art.
  const colors = ["#fff3a3", "#ffcf4a", "#ff8f3d"];
  for (let i = 0; i < 8; i++) {
    const angle = (i / 8) * Math.PI * 2 + 0.2;
    const distance = 8 + burst * (25 + (i % 2) * 10);
    pixelStar(ctx, Math.cos(angle) * distance, Math.sin(angle) * distance - rise * 0.18, 7 - t * 3, colors[i % colors.length], fade * (1 - t * 0.55));
  }

  // The collected sprite squashes on contact, then stretches and rises before
  // disappearing. Keeping the real atlas frame ties the effect to the pickup.
  const squash = Math.sin(Math.min(1, t * 2.4) * Math.PI);
  const scaleX = 1 + squash * 0.28 + t * 0.18;
  const scaleY = 1 - squash * 0.22 + t * 0.38;
  ctx.globalAlpha = fade;
  fruitAnim.draw(ctx, 0, -rise, { w: 32 * scaleX, h: 32 * scaleY });
  pixelStar(ctx, -7, -rise - 8, 8 + (1 - t) * 5, "#fff", fade);
  ctx.restore();
}

// Cache the unchanging sky and terrain. The previous renderer rebuilt a
// pattern/gradient and issued dozens of large, upscaled tile draws every frame.
function makeStaticLayers() {
  skyLayer = Sprites.getLayer("pixel-adventure:sky", GAME_W, GAME_H, 1, (skyCtx) => {
    skyCtx.imageSmoothingEnabled = false;
    const pattern = skyCtx.createPattern(backdrop, "repeat");
    if (pattern) { skyCtx.fillStyle = pattern; skyCtx.fillRect(0, 0, GAME_W, GAME_H); }
    const sky = skyCtx.createLinearGradient(0, 0, 0, GAME_H);
    sky.addColorStop(0, "rgba(86,205,225,.3)"); sky.addColorStop(1, "rgba(36,91,155,.35)");
    skyCtx.fillStyle = sky; skyCtx.fillRect(0, 0, GAME_W, GAME_H);
    skyCtx.fillStyle = "rgba(255,244,184,.75)"; skyCtx.beginPath(); skyCtx.arc(400, 50, 23, 0, Math.PI * 2); skyCtx.fill();
  });

  // Real tiling at native atlas resolution. The atlas holds a 3×3 grass block
  // of 16px sub-tiles at pixel (96,0): grass-top row / dirt-middle / dirt-bottom,
  // each with left / mid / right variants. Each 48px collision cell is paved
  // with a 3×3 grid of these 16px tiles drawn 1:1 (crisp — no upscaling, so the
  // ground matches the sprite resolution), and every sub-tile picks its edge
  // from the cell's open neighbours. Result: grassy lips on top, dirt sides and
  // proper corners, instead of one blurry block stamped everywhere.
  const SUB = 16, BX = 96, BY = 0, N = TILE / SUB; // N = 3 sub-tiles per cell
  terrainLayer = Sprites.getLayer("pixel-adventure:terrain", map.worldW, map.worldH, 1, (terrainCtx) => {
    terrainCtx.imageSmoothingEnabled = false;
    for (let y = 0; y < map.rows; y++) for (let x = 0; x < map.cols; x++) if (map.at(x, y)) {
      const px = x * TILE, py = y * TILE;
      const openU = !map.at(x, y - 1), openD = !map.at(x, y + 1);
      const openL = !map.at(x - 1, y), openR = !map.at(x + 1, y);
      terrainCtx.fillStyle = "rgba(19,45,65,.28)"; terrainCtx.fillRect(px + 4, py + 5, TILE, TILE);
      for (let sr = 0; sr < N; sr++) for (let sc = 0; sc < N; sc++) {
        // Only the outer ring of sub-tiles reflects an exposed edge; the rest is
        // solid dirt-middle. Corners fall out naturally where two edges meet.
        const eU = openU && sr === 0, eD = openD && sr === N - 1;
        const eL = openL && sc === 0, eR = openR && sc === N - 1;
        const srcX = BX + (eL ? 0 : eR ? 2 : 1) * SUB;
        const srcY = BY + (eU ? 0 : eD ? 2 : 1) * SUB;
        terrainCtx.drawImage(terrain, srcX, srcY, SUB, SUB, px + sc * SUB, py + sr * SUB, SUB, SUB);
      }
    }
  });
}

// The manifest composes each sprite sheet into an Animation as it loads, so
// the `.then` receives ready-to-use anims — no Anim.sheet(Assets.image(…))
// glue. Plain URLs stay images/JSON; `sheet` specs become Animations.
const asset = (p) => new URL(`../assets/${p}`, import.meta.url).href;
const frog = { fw: 32, fh: 32 };
Assets.load({
  level: new URL("../level.json", import.meta.url).href,
  terrain: asset("terrain.png"),
  background: asset("background.png"),
  playerIdle: { src: asset("player-idle.png"), sheet: { ...frog, fps: 8 } },
  playerRun: { src: asset("player-run.png"), sheet: { ...frog, fps: 12 } },
  playerJump: { src: asset("player-jump.png"), sheet: frog },
  playerFall: { src: asset("player-fall.png"), sheet: frog },
  playerHit: { src: asset("player-hit.png"), sheet: { ...frog, fps: 14 } },
  enemy: { src: asset("radish-run.png"), sheet: { fw: 30, fh: 38, fps: 9 } },
  fruit: { src: asset("bananas.png"), sheet: { fw: 32, fh: 32, fps: 10 } },
  goal: { src: asset("goal.png"), sheet: { fw: 64, fh: 64, fps: 5 } },
}).then((A) => {
  level = A.level; terrain = A.terrain; backdrop = A.background;
  map = Tiles.grid(level.tiles, { tw: TILE, atlas: terrain, cols: Math.floor(terrain.width / TILE), solid: (tile) => tile === 1 });
  playerAnim = Anim.states({
    idle: A.playerIdle, run: A.playerRun, jump: A.playerJump, fall: A.playerFall, hit: A.playerHit,
  }, "idle");
  // The player's animation is driven by a state machine whose states map 1:1
  // to the animation clips — every transition auto-plays the matching clip via
  // the { anim } bridge, so there's no hand-mirrored play() call. Each state
  // recomputes the desired state from live physics (a fully-connected machine).
  const playerState = () =>
    player.hurtTimer > 0
      ? "hit"
      : !player.onGround
        ? player.vy < 0
          ? "jump"
          : "fall"
        : Math.abs(player.vx) > 18
          ? "run"
          : "idle";
  playerSm = Fsm.create(
    {
      idle: { update: playerState },
      run: { update: playerState },
      jump: { update: playerState },
      fall: { update: playerState },
      hit: { update: playerState },
    },
    "idle",
    { anim: playerAnim },
  );
  enemyAnim = A.enemy; fruitAnim = A.fruit; goalAnim = A.goal;
  coins = level.coins.map(([x, y]) => ({ x: x * TILE + TILE / 2, y: y * TILE + TILE / 2, got: false, pop: 0 }));
  enemies = level.enemies.map(([x, y], i) => ({ x: x * TILE + TILE / 2, y: y * TILE, w: 28, h: 35, vx: i % 2 ? -45 : 45, dead: false }));
  goal = { x: level.goal[0] * TILE + TILE / 2, y: level.goal[1] * TILE + TILE / 2 };
  makeStaticLayers();
  cam = Camera.createCamera({ worldW: map.worldW, worldH: map.worldH, viewW: GAME_W, viewH: GAME_H, damping: 0.1, deadZoneX: 0.14, deadZoneY: 0.1 });
  cam.zoom = 0.8;
  resetRun(); ready = true;
}).catch((error) => (failed = String(error)));

Loop.run({
  update(stepMs) {
    if (!ready) return;
    if (Keys.pressed("KeyR")) { resetRun(); return; }
    if (state !== "play") return;
    const dt = stepMs / 1000;
    elapsed += dt;
    player.invuln = Math.max(0, player.invuln - dt);
    player.hurtTimer = Math.max(0, player.hurtTimer - dt);
    enemyAnim.update(stepMs); fruitAnim.update(stepMs); goalAnim.update(stepMs);
    const direction = (input.down("right") ? 1 : 0) - (input.down("left") ? 1 : 0);
    if (direction) { player.vx += direction * 900 * dt; player.facing = direction; }
    else player.vx = Mathf.damp(player.vx, 0, 7.1, dt);
    player.vx = Mathf.clamp(player.vx, -165, 165);
    // A 96px first ledge needs a 140px jump arc (the -525 impulse). The impulse
    // is ours; the coyote-grace + input-buffer timing is the gate's.
    const pressedJump = input.pressed("jump");
    // Wall-cling only when airborne AND actively holding toward the wall, so a
    // brush past a ledge never feels sticky — the classic wall-slide condition.
    const intoWall =
      (player.wall === -1 && input.down("left")) || (player.wall === 1 && input.down("right"));
    const onWall = !player.onGround && intoWall;
    if (jumpGate.update(player.onGround, pressedJump, stepMs)) {
      player.vy = -525;
      player.onGround = false;
      SFX.jump();
    } else if (pressedJump && onWall) {
      // Wall jump — composed straight from moveAABB's wall contact + a chosen
      // impulse (up and away). No wall-jump helper: the engine reports the
      // contact, the game decides the launch.
      player.vy = -470;
      player.vx = -player.wall * 235;
      player.facing = -player.wall;
      jumpGate.buffer.consume(); // don't let this press also fire a ground jump on landing
      SFX.jump();
    }
    player.vy = Math.min(620, player.vy + 980 * dt);
    // Wall slide: cling and drift down slowly while pressing a wall midair, so
    // the wall jump has a window to trigger.
    if (onWall && player.vy > 110) player.vy = 110;
    movePlayer(player.vx * dt, player.vy * dt);
    // The state machine picks the animation clip (auto-played via its bridge);
    // we just advance the active clip's timeline.
    playerSm.update(stepMs);
    playerAnim.update(stepMs);

    for (const enemy of enemies) {
      if (enemy.dead) continue;
      enemy.x += enemy.vx * dt;
      if (solid(enemy)) { enemy.x -= enemy.vx * dt; enemy.vx *= -1; }
      if (Collision.rectsOverlap(rect(player), rect(enemy))) {
        if (player.vy > 55 && player.y - player.h / 2 < enemy.y - enemy.h / 2) {
          enemy.dead = true; player.vy = -270; SFX.stomp(); Camera.shake(3.5, 190); // punch on a kill
          UI.floatText("+100", enemy.x, enemy.y - 45, { color: "#ffe066" });
          Particles.burst(enemy.x, enemy.y - 20, { count: 18, colors: ["#ff9f43", "#ffe066"], speed: [45, 160], life: [260, 620], gravity: 180 });
        } else hurt();
      }
    }
    for (const coin of coins) {
      if (coin.got) { coin.pop += dt; continue; }
      if (!Collision.circleHit(player.x, player.y, 0, coin.x, coin.y, 27)) continue;
      coin.got = true; coin.pop = 0; SFX.coin(); // no shake on a pickup
      UI.floatText("FRUIT!", coin.x, coin.y - 26, { color: "#fff3a3" });
      Particles.burst(coin.x, coin.y, { count: 24, colors: ["#fff", "#fff3a3", "#ffe066", "#ffb347"], size: [2, 5], speed: [55, 205], life: [300, 680], gravity: 105 });
      Particles.burst(coin.x, coin.y, { count: 8, angle: -Math.PI / 2, spread: 0.55, colors: "#ffffff", size: [2, 4], speed: [115, 210], life: [190, 370] });
      if (coins.every((c) => c.got)) { SFX.unlock(); UI.floatText("GOAL UNLOCKED!", player.x, player.y - 60, { color: "#64f0c8" }); }
    }
    if (player.y > map.worldH + 70) hurt();
    if (coins.every((coin) => coin.got) && Collision.circleHit(player.x, player.y, 0, goal.x, goal.y, 38)) { state = "won"; SFX.win(); }
    cam.update(player.x, player.y - player.h / 2, Draw.frameScale);
  },

  draw(ctx) {
    const box = Game.drawLetterbox(ctx, vp.w, vp.h, GAME_W, GAME_H, "#10182b", "#58c7dc");
    ctx.save(); ctx.translate(box.ox, box.oy); ctx.scale(box.scale, box.scale); ctx.imageSmoothingEnabled = false;
    if (!ready) {
      UI.panel(ctx, { x: 110, y: 88, w: 260, h: 86, title: "PIXEL ADVENTURE" });
      UI.bar(ctx, 135, 133, 210, 10, Assets.progress, { fill: "#ffe066", bg: "#263653" });
      ctx.fillStyle = "#fff"; ctx.font = "12px monospace"; ctx.textAlign = "center"; ctx.fillText(failed || "LOADING PIXEL FROG ATLASES…", 240, 119); ctx.textAlign = "left";
      ctx.restore(); return;
    }

    // The static art is now one native-resolution sky blit and one terrain
    // blit, independent of tile count. Rounding preserves pixel-art stability.
    ctx.drawImage(skyLayer, 0, 0);
    const viewW = GAME_W / cam.zoom, viewH = GAME_H / cam.zoom;
    const cameraX = Math.min(Math.round(cam.x), map.worldW - viewW);
    const cameraY = Math.min(Math.round(cam.y), map.worldH - viewH);
    ctx.save(); ctx.translate(Math.round(Camera.shakeX()), Math.round(Camera.shakeY()));
    ctx.drawImage(terrainLayer, cameraX, cameraY, viewW, viewH, 0, 0, GAME_W, GAME_H);

    ctx.save(); ctx.scale(cam.zoom, cam.zoom); ctx.translate(-cameraX, -cameraY);
    const unlocked = coins.every((coin) => coin.got);
    goalAnim.draw(ctx, goal.x, goal.y, { w: 58, h: 58 });
    if (!unlocked) { ctx.fillStyle = "rgba(10,22,44,.65)"; ctx.fillRect(goal.x - 20, goal.y - 30, 40, 50); }
    for (const coin of coins) {
      if (!coin.got) fruitAnim.draw(ctx, coin.x, coin.y, { w: 32, h: 32 });
      else if (coin.pop < 0.68) drawFruitPickup(ctx, coin);
    }
    // The radish art faces left by default, so face = +1 when moving left.
    for (const enemy of enemies) if (!enemy.dead) drawFlipped(enemyAnim, ctx, enemy.x, enemy.y - 20, enemy.vx < 0 ? 1 : -1, { w: 42, h: 53 });
    if (player.invuln <= 0 || Math.floor(elapsed * 12) % 2) drawFlipped(playerAnim, ctx, player.x, player.y - 18, player.facing, { w: 48, h: 48 });
    UI.drawFloatText(ctx); Particles.draw(ctx); ctx.restore();
    ctx.restore(); // camera shake
    ctx.restore(); // end letterbox — the HUD below is drawn in SCREEN space at a
    // fixed pixel size, so the world can be scaled/zoomed independently of it.

    UI.group({ x: 12, y: 12, w: 236, h: 60, title: "SUNNY RUN" }, (body) => {
      UI.text(`FRUIT ${coins.filter((coin) => coin.got).length}/${coins.length}   LIVES ${"◆".repeat(lives)}`,
        { h: body.remaining, size: 13, color: "#fff" });
    });
    ctx.textAlign = "left";
    ctx.fillStyle = "#e9f8ff"; ctx.font = "12px monospace";
    ctx.fillText(unlocked ? "GOAL UNLOCKED!" : "Find all fruit", 14, vp.h - 14);
    if (state === "won" || state === "gameover") {
      const won = state === "won";
      const cx = vp.w / 2, cy = vp.h / 2;
      ctx.fillStyle = "rgba(7,15,30,.78)"; ctx.fillRect(0, 0, vp.w, vp.h);
      UI.group(
        { x: cx - 140, y: cy - 58, w: 280, h: 116, title: won ? "ADVENTURE COMPLETE" : "TRY AGAIN", border: won ? "#64f0c8" : "#ff6b6b" },
        () => {
          UI.text(won ? "YOU FOUND THE WAY!" : "OUT OF LIVES", { h: 44, size: 18, bold: true, align: "center", color: won ? "#64f0c8" : "#ff6b6b" });
          UI.text("Press R to restart", { h: 24, size: 12, align: "center", color: "#fff" });
        },
      );
    }
  },
});
