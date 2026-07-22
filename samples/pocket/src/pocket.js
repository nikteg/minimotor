// POCKET ASTEROIDS: a complete vector arcade loop in a fixed 16:9 viewport.
// Focus: Stage fullscreen, Game.letterbox, Goodies torus helpers, Input.map with pad bindings.
// Controls: left/right rotate, up thrusts, Space fires, H hyperspace.
import { Draw, Game, Gizmos, Goodies, Input, Loop, Mathf, Particles, Perf, Stage, UI } from "minimotor";
import * as Sfx from "../../shared/src/sfx.ts";

// Fullscreen stylesheet + live viewport in one call (vp mutates on resize).
const vp = Stage.init("game", { fullscreen: true, plugins: [Perf.plugin()] });
// The fixed 16:9 field is letterboxed (uniform scale + bars) at any window
// size, so the vector art never distorts.
const input = Input.map({
  left: ["ArrowLeft", "KeyA", "pad:dpad-left", "pad:lstick-left"],
  right: ["ArrowRight", "KeyD", "pad:dpad-right", "pad:lstick-right"],
  thrust: ["ArrowUp", "KeyW", "pad:dpad-up", "pad:lstick-up"],
  fire: ["Space", "Enter", "pad:a"],
  hyperspace: ["KeyH", "ShiftLeft", "pad:b"],
});
// A roomier logical viewport keeps ships and rocks readable on large screens.
const W = 480, H = 270;
// Per-step feel constants (the fixed step is the time unit — 60 steps/s).
const TURN = 0.075; // rad/step (was 4.5 rad/s)
const THRUST = 0.031; // px/step² (was 110 px/s²)
const BULLET_SPEED = 3.7; // px/step (was 220 px/s)
const BULLET_TTL = 66; // steps (was 1.1 s)
const FIRE_COOLDOWN = 11; // steps (was 0.18 s)
const best = Game.createScoreTracker("pocket-asteroids-best");
const fx = Particles.create();
const ship = { x: W / 2, y: H / 2, vx: 0, vy: 0, angle: -Math.PI / 2, cooldown: 0, invuln: 0 };
// One hyperspace jump that recharges over 4s (a Goodies charge meter). fraction
// drives the HUD bar; refill() tops it off on respawn.
const hyper = Gizmos.charges({ max: 1, refillMs: 4000 });
const bullets = [], asteroids = [];
const stars = Array.from({ length: 64 }, (_, i) => ({ x: 8 + (i * 71) % (W - 16), y: 8 + (i * 43) % (H - 16), r: i % 9 === 0 ? 1.2 : 0.7 }));
let sessionScore = 0, lives = 3, level = 1, state = "title", steps = 0;

function torusDistance(ax, ay, bx, by) {
  return Goodies.wrappedDistance(ax, ay, bx, by, W, H);
}
function resetShip() {
  ship.x = W / 2; ship.y = H / 2; ship.vx = 0; ship.vy = 0; ship.angle = -Math.PI / 2;
  ship.invuln = 120; hyper.refill();
}
function makeAsteroid(x, y, size, speed = 1) {
  const r = size === 3 ? 14 : size === 2 ? 9 : 5;
  const a = Math.random() * Math.PI * 2;
  const verts = Array.from({ length: 9 }, (_, i) => ({ a: i / 9 * Math.PI * 2, r: r * (0.78 + Math.random() * 0.38) }));
  asteroids.push({ x, y, r, size, vx: Math.cos(a) * (0.3 + Math.random() * 0.4) * speed, vy: Math.sin(a) * (0.3 + Math.random() * 0.4) * speed, rot: (Math.random() - .5) * 0.04, angle: Math.random() * 6, verts });
}
function newWave() {
  for (let i = 0; i < 3 + level; i++) {
    let x = Math.random() * W, y = Math.random() * H, attempts = 0;
    // Use torus distance: a rock at x=2 is also close to a ship at x=318.
    while (torusDistance(x, y, ship.x, ship.y) < 70 && attempts++ < 40) { x = Math.random() * W; y = Math.random() * H; }
    makeAsteroid(x, y, 3, 1 + level * .08);
  }
}
function hyperspace() {
  if (!hyper.use()) return; // spend the charge if one is ready
  let x = ship.x, y = ship.y;
  for (let i = 0; i < 30; i++) {
    x = Math.random() * W; y = Math.random() * H;
    if (asteroids.every((a) => torusDistance(x, y, a.x, a.y) > a.r + 28)) break;
  }
  ship.x = x; ship.y = y; ship.vx *= .3; ship.vy *= .3; ship.invuln = 72;
  Sfx.click();
}
function startGame() { bullets.length = 0; asteroids.length = 0; sessionScore = 0; lives = 3; level = 1; steps = 0; state = "play"; resetShip(); newWave(); }
function explodeAsteroid(a) {
  const points = a.size === 3 ? 20 : a.size === 2 ? 50 : 100;
  sessionScore += points; best.add(points);
  fx.burst({ at: a, count: a.size * 9, color: ["#ffe066", "#ff9f43", "#ff6b6b"], speed: [0.5, 2.8], size: [1, 3], life: [220, 600], gravity: 0 });
  Sfx.hit();
  if (a.size > 1) { makeAsteroid(a.x, a.y, a.size - 1, 1.1); makeAsteroid(a.x, a.y, a.size - 1, 1.1); }
}
function fire() {
  if (ship.cooldown > 0) return;
  ship.cooldown = FIRE_COOLDOWN;
  bullets.push({ x: ship.x + Math.cos(ship.angle) * 10, y: ship.y + Math.sin(ship.angle) * 10, vx: ship.vx + Math.cos(ship.angle) * BULLET_SPEED, vy: ship.vy + Math.sin(ship.angle) * BULLET_SPEED, ttl: BULLET_TTL });
  Sfx.zap();
}

Loop.run({
  update() {
    if (state === "title") { if (input.fire.pressed) startGame(); return; }
    if (state === "gameover") { if (input.fire.pressed) startGame(); return; }
    steps++;
    ship.cooldown = Math.max(0, ship.cooldown - 1); ship.invuln = Math.max(0, ship.invuln - 1); hyper.tick(Loop.step);
    const turn = input.axis("left", "right"); // analog-aware: sticks report magnitude
    ship.angle += turn * TURN;
    if (input.thrust.down) { ship.vx += Math.cos(ship.angle) * THRUST; ship.vy += Math.sin(ship.angle) * THRUST; }
    ship.vx = Mathf.damp(ship.vx, 0, 0.48, 1 / 60); ship.vy = Mathf.damp(ship.vy, 0, 0.48, 1 / 60);
    ship.x = Goodies.wrap(ship.x + ship.vx, W); ship.y = Goodies.wrap(ship.y + ship.vy, H);
    if (input.fire.down) fire();
    if (input.hyperspace.pressed) hyperspace();
    for (let i = bullets.length - 1; i >= 0; i--) { const b = bullets[i]; b.x = Goodies.wrap(b.x + b.vx, W); b.y = Goodies.wrap(b.y + b.vy, H); b.ttl -= 1; if (b.ttl <= 0) bullets.splice(i, 1); }
    for (const a of asteroids) { a.x = Goodies.wrap(a.x + a.vx, W); a.y = Goodies.wrap(a.y + a.vy, H); a.angle += a.rot; }
    for (let bi = bullets.length - 1; bi >= 0; bi--) {
      const b = bullets[bi]; let hit = false;
      for (let ai = asteroids.length - 1; ai >= 0; ai--) {
        const a = asteroids[ai];
        if (torusDistance(b.x, b.y, a.x, a.y) < a.r + 1.5) {
          asteroids.splice(ai, 1); bullets.splice(bi, 1); explodeAsteroid(a); hit = true; break;
        }
      }
      if (hit) continue;
    }
    if (ship.invuln <= 0) for (const a of asteroids) if (torusDistance(ship.x, ship.y, a.x, a.y) < a.r + 8) {
      lives--; Sfx.lose(); fx.burst({ at: ship, count: 35, color: ["#ff6b6b", "#ffe066"], speed: [0.7, 3.5], life: [300, 800] });
      if (lives <= 0) state = "gameover"; else resetShip(); break;
    }
    if (asteroids.length === 0) { level++; Sfx.wave(); newWave(); }
  },
  draw(ctx) {
    // Uniform letterbox at every size: the play field is a fixed 16:9 torus, so
    // stretching it to a non-16:9 window would squash the asteroids and ship,
    // and cropping would hide wrapped objects. Mobile keeps the same policy.
    // The letterbox owns clearing (fills the full canvas), so no engine background.
    const box = Game.drawLetterbox(ctx, vp.w, vp.h, W, H, "#03050c", "#080d1b");
    ctx.save();
    ctx.translate(box.ox, box.oy);
    ctx.scale(box.scale, box.scale);
    for (const s of stars) Draw.circle(s, s.r, s.r > 1 ? "#d9e6ff" : "#53698f");
    for (const b of bullets) Draw.circle(b, 1.5, "#ffe066");
    // The rocks and the ship are stroked polygon paths — the raw-ctx escape hatch.
    for (const a of asteroids) { ctx.save(); ctx.translate(a.x, a.y); ctx.rotate(a.angle); ctx.beginPath(); a.verts.forEach((v, i) => { const x = Math.cos(v.a) * v.r, y = Math.sin(v.a) * v.r; i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }); ctx.closePath(); ctx.fillStyle = a.size === 3 ? "#293b5d" : a.size === 2 ? "#33496d" : "#496488"; ctx.fill(); ctx.strokeStyle = "#9fb3d9"; ctx.lineWidth = 1; ctx.stroke(); ctx.restore(); }
    if (state === "play" && (ship.invuln <= 0 || Math.floor(steps / 5) % 2)) {
      ctx.save(); ctx.translate(ship.x, ship.y); ctx.rotate(ship.angle); ctx.strokeStyle = "#64f0c8"; ctx.fillStyle = "#142f43"; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(11, 0); ctx.lineTo(-8, -7); ctx.lineTo(-5, 0); ctx.lineTo(-8, 7); ctx.closePath(); ctx.fill(); ctx.stroke();
      if (input.thrust.down) { ctx.fillStyle = "#ff9f43"; ctx.beginPath(); ctx.moveTo(-6, -3); ctx.lineTo(-15 - Math.random() * 5, 0); ctx.lineTo(-6, 3); ctx.fill(); }
      ctx.restore();
    }
    Draw.particles(fx);
    UI.panel(ctx, { x: 4, y: 3, w: 300, h: 23, bg: "rgba(3,5,12,.72)", border: "#30496e" });
    UI.text(ctx, `SCORE ${sessionScore}  BEST ${best.best}  WAVE ${level}`, { x: 9, y: 4, size: 8, color: "#fff" });
    UI.text(ctx, `LIVES ${"◆".repeat(Math.max(0, lives))}`, { x: 9, y: H - 17, size: 8, color: "#fff" });
    UI.text(ctx, "HYPER", { x: W - 65, y: H - 17, size: 8, color: "dim" });
    UI.bar(ctx, W - 37, H - 14, 30, 6, hyper.fraction, { fill: "#b197fc", bg: "#1b2740" });
    if (state === "title" || state === "gameover") { Draw.rect(0, 0, W, H, "rgba(3,5,12,.75)"); UI.text(ctx, state === "title" ? "POCKET ASTEROIDS" : "SHIP LOST", { x: W / 2, y: 40, size: 25, bold: true, color: state === "title" ? "#64f0c8" : "#ff6b6b", align: "center" }); UI.text(ctx, state === "title" ? "SPACE / A BUTTON TO LAUNCH" : `SCORE ${sessionScore} · SPACE TO RESTART`, { x: W / 2, y: 75, size: 9, color: "#fff", align: "center" }); UI.text(ctx, "ROTATE · THRUST · FIRE · HYPERSPACE", { x: W / 2, y: 93, size: 9, color: "dim", align: "center" }); }
    ctx.restore();
  },
});
