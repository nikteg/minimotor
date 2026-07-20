// POCKET ASTEROIDS: a complete vector arcade loop in a fixed 16:9 viewport.
// Focus: Fullscreen, Game.letterbox, Goodies torus helpers, Input and gamepad.
// Controls: left/right rotate, up thrusts, Space fires, H hyperspace.
import { Minimotor } from "minimotor";
import * as Sfx from "../shared/sfx.js";

Minimotor.Fullscreen.applyFullscreen();
let vp = Minimotor.Stage.init("game", { plugins: [Minimotor.Perf.plugin()] });
Minimotor.Stage.onResize((next) => (vp = next));
const { Loop, Input, Game, Goodies, Mathf, Particles, UI } = Minimotor;
// The fixed 16:9 field is letterboxed (uniform scale + bars) at any window
// size, so the vector art never distorts.
const actions = Input.actions({
  left: ["ArrowLeft", "KeyA"],
  right: ["ArrowRight", "KeyD"],
  thrust: ["ArrowUp", "KeyW"],
  fire: ["Space", "Enter"],
  hyperspace: ["KeyH", "ShiftLeft"],
});
const pad = Input.gamepad();
// A roomier logical viewport keeps ships and rocks readable on large screens.
const W = 480, H = 270;
const best = Game.createScoreTracker("pocket-asteroids-best");
const ship = { x: W / 2, y: H / 2, vx: 0, vy: 0, angle: -Math.PI / 2, cooldown: 0, invuln: 0, hyperspace: 0 };
const bullets = [], asteroids = [];
const stars = Array.from({ length: 64 }, (_, i) => ({ x: 8 + (i * 71) % (W - 16), y: 8 + (i * 43) % (H - 16), r: i % 9 === 0 ? 1.2 : 0.7 }));
let sessionScore = 0, lives = 3, level = 1, state = "title", elapsed = 0;

function torusDistance(ax, ay, bx, by) {
  return Goodies.wrappedDistance(ax, ay, bx, by, W, H);
}
function resetShip() {
  ship.x = W / 2; ship.y = H / 2; ship.vx = 0; ship.vy = 0; ship.angle = -Math.PI / 2;
  ship.invuln = 2; ship.hyperspace = 0;
}
function makeAsteroid(x, y, size, speed = 1) {
  const r = size === 3 ? 14 : size === 2 ? 9 : 5;
  const a = Math.random() * Math.PI * 2;
  const verts = Array.from({ length: 9 }, (_, i) => ({ a: i / 9 * Math.PI * 2, r: r * (0.78 + Math.random() * 0.38) }));
  asteroids.push({ x, y, r, size, vx: Math.cos(a) * (18 + Math.random() * 24) * speed, vy: Math.sin(a) * (18 + Math.random() * 24) * speed, rot: (Math.random() - .5) * 2.4, angle: Math.random() * 6, verts });
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
  if (ship.hyperspace > 0) return;
  let x = ship.x, y = ship.y;
  for (let i = 0; i < 30; i++) {
    x = Math.random() * W; y = Math.random() * H;
    if (asteroids.every((a) => torusDistance(x, y, a.x, a.y) > a.r + 28)) break;
  }
  ship.x = x; ship.y = y; ship.vx *= .3; ship.vy *= .3; ship.invuln = 1.2; ship.hyperspace = 4;
  Sfx.click();
}
function startGame() { bullets.length = 0; asteroids.length = 0; sessionScore = 0; lives = 3; level = 1; elapsed = 0; state = "play"; resetShip(); newWave(); }
function explodeAsteroid(a) {
  const points = a.size === 3 ? 20 : a.size === 2 ? 50 : 100;
  sessionScore += points; best.add(points);
  Particles.burst(a.x, a.y, { count: a.size * 9, colors: ["#ffe066", "#ff9f43", "#ff6b6b"], speed: [30, 170], size: [1, 3], life: [220, 600], gravity: 0 });
  Sfx.hit();
  if (a.size > 1) { makeAsteroid(a.x, a.y, a.size - 1, 1.1); makeAsteroid(a.x, a.y, a.size - 1, 1.1); }
}
function fire() {
  if (ship.cooldown > 0) return;
  ship.cooldown = .18;
  bullets.push({ x: ship.x + Math.cos(ship.angle) * 10, y: ship.y + Math.sin(ship.angle) * 10, vx: ship.vx + Math.cos(ship.angle) * 220, vy: ship.vy + Math.sin(ship.angle) * 220, ttl: 1.1 });
  Sfx.zap();
}

Loop.run({
  update(stepMs) {
    const dt = stepMs / 1000;
    if (state === "title") { if (actions.pressed("fire") || pad.pressed(Input.Buttons.A)) startGame(); return; }
    if (state === "gameover") { if (actions.pressed("fire") || pad.pressed(Input.Buttons.A)) startGame(); return; }
    elapsed += dt;
    ship.cooldown = Math.max(0, ship.cooldown - dt); ship.invuln = Math.max(0, ship.invuln - dt); ship.hyperspace = Math.max(0, ship.hyperspace - dt);
    const axis = pad.axis(0);
    const turn = (actions.down("right") ? 1 : 0) - (actions.down("left") ? 1 : 0) || axis;
    ship.angle += turn * 4.5 * dt;
    const thrusting = actions.down("thrust") || pad.axis(1) < -.35;
    if (thrusting) { ship.vx += Math.cos(ship.angle) * 110 * dt; ship.vy += Math.sin(ship.angle) * 110 * dt; }
    ship.vx *= Math.pow(.992, dt * 60); ship.vy *= Math.pow(.992, dt * 60);
    ship.x = Goodies.wrap(ship.x + ship.vx * dt, W); ship.y = Goodies.wrap(ship.y + ship.vy * dt, H);
    const firing = actions.down("fire") || pad.down(Input.Buttons.A);
    if (firing) fire();
    if (actions.pressed("hyperspace") || pad.pressed(Input.Buttons.B)) hyperspace();
    for (let i = bullets.length - 1; i >= 0; i--) { const b = bullets[i]; b.x = Goodies.wrap(b.x + b.vx * dt, W); b.y = Goodies.wrap(b.y + b.vy * dt, H); b.ttl -= dt; if (b.ttl <= 0) bullets.splice(i, 1); }
    for (const a of asteroids) { a.x = Goodies.wrap(a.x + a.vx * dt, W); a.y = Goodies.wrap(a.y + a.vy * dt, H); a.angle += a.rot * dt; }
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
      lives--; Sfx.lose(); Particles.burst(ship.x, ship.y, { count: 35, colors: ["#ff6b6b", "#ffe066"], speed: [40, 210], life: [300, 800] });
      if (lives <= 0) state = "gameover"; else resetShip(); break;
    }
    if (asteroids.length === 0) { level++; Sfx.wave(); newWave(); }
  },
  draw(ctx) {
    // Uniform letterbox at every size: the play field is a fixed 16:9 torus, so
    // stretching it to a non-16:9 window would squash the asteroids and ship,
    // and cropping would hide wrapped objects. Mobile keeps the same policy.
    const box = Game.drawLetterbox(ctx, vp.w, vp.h, W, H, "#03050c", "#080d1b");
    ctx.save();
    ctx.translate(box.ox, box.oy);
    ctx.scale(box.scale, box.scale);
    for (const s of stars) { ctx.fillStyle = s.r > 1 ? "#d9e6ff" : "#53698f"; ctx.beginPath(); ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2); ctx.fill(); }
    for (const b of bullets) { ctx.fillStyle = "#ffe066"; ctx.beginPath(); ctx.arc(b.x, b.y, 1.5, 0, Math.PI * 2); ctx.fill(); }
    for (const a of asteroids) { ctx.save(); ctx.translate(a.x, a.y); ctx.rotate(a.angle); ctx.beginPath(); a.verts.forEach((v, i) => { const x = Math.cos(v.a) * v.r, y = Math.sin(v.a) * v.r; i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); }); ctx.closePath(); ctx.fillStyle = a.size === 3 ? "#293b5d" : a.size === 2 ? "#33496d" : "#496488"; ctx.fill(); ctx.strokeStyle = "#9fb3d9"; ctx.lineWidth = 1; ctx.stroke(); ctx.restore(); }
    if (state === "play" && (ship.invuln <= 0 || Math.floor(elapsed * 12) % 2)) {
      ctx.save(); ctx.translate(ship.x, ship.y); ctx.rotate(ship.angle); ctx.strokeStyle = "#64f0c8"; ctx.fillStyle = "#142f43"; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.moveTo(11, 0); ctx.lineTo(-8, -7); ctx.lineTo(-5, 0); ctx.lineTo(-8, 7); ctx.closePath(); ctx.fill(); ctx.stroke();
      if (actions.down("thrust") || pad.axis(1) < -.35) { ctx.fillStyle = "#ff9f43"; ctx.beginPath(); ctx.moveTo(-6, -3); ctx.lineTo(-15 - Math.random() * 5, 0); ctx.lineTo(-6, 3); ctx.fill(); }
      ctx.restore();
    }
    Particles.draw(ctx);
    UI.panel(ctx, { x: 4, y: 3, w: 300, h: 23, bg: "rgba(3,5,12,.72)", border: "#30496e" });
    UI.text(ctx, `SCORE ${sessionScore}  BEST ${best.best}  WAVE ${level}`, { x: 9, y: 4, size: 8, color: "#fff" });
    UI.text(ctx, `LIVES ${"◆".repeat(Math.max(0, lives))}`, { x: 9, y: H - 17, size: 8, color: "#fff" });
    UI.text(ctx, "HYPER", { x: W - 65, y: H - 17, size: 8, color: "dim" });
    UI.bar(ctx, W - 37, H - 14, 30, 6, ship.hyperspace > 0 ? 1 - ship.hyperspace / 4 : 1, { fill: "#b197fc", bg: "#1b2740" });
    if (state === "title" || state === "gameover") { ctx.fillStyle = "rgba(3,5,12,.75)"; ctx.fillRect(0, 0, W, H); UI.text(ctx, state === "title" ? "POCKET ASTEROIDS" : "SHIP LOST", { x: W / 2, y: 40, size: 25, bold: true, color: state === "title" ? "#64f0c8" : "#ff6b6b", align: "center" }); UI.text(ctx, state === "title" ? "SPACE / A BUTTON TO LAUNCH" : `SCORE ${sessionScore} · SPACE TO RESTART`, { x: W / 2, y: 75, size: 9, color: "#fff", align: "center" }); UI.text(ctx, "ROTATE · THRUST · FIRE · HYPERSPACE", { x: W / 2, y: 93, size: 9, color: "dim", align: "center" }); }
    ctx.restore();
  },
});
