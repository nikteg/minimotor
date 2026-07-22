// PARALLAX COURIER: deliver a signal through a huge neon valley.
// Focus: the always-existing default Camera (follow, dead-zone, zoom,
// screen↔world mapping via Camera.toWorld) and Camera.layer for stable
// procedural parallax scenery.
import { Audio, Camera, Draw, Input, Keys, Loop, Mathf, Particles, Perf, Pointer, Stage, UI } from "minimotor";
import * as Sfx from "../../shared/src/sfx.js";

// The viewport is LIVE (mutated on resize); the engine owns clearing.
const view = Stage.init("game", { background: "#080b18", plugins: [Perf.plugin()] });
const input = Input.map({ left: ["ArrowLeft", "KeyA"], right: ["ArrowRight", "KeyD"], up: ["ArrowUp", "KeyW"], down: ["ArrowDown", "KeyS"] });
const worldW = 3600, worldH = 900;
const STEP_S = 1 / 60; // seconds per fixed step (timers display in seconds)
const courier = { x: 320, y: 460, r: 16, speed: 260 / 60 /* px/step */, angle: 0, invuln: 0 };
const beacons = [{ x: 900, y: 260 }, { x: 1900, y: 680 }, { x: 2900, y: 300 }];
const drones = Array.from({ length: 9 }, (_, i) => ({ x: 500 + i * 360, y: 180 + (i * 157) % 600, phase: i * 1.7 }));
const fx = Particles.create();
let beaconIndex = 0, lives = 3, elapsed = 0, state = "play";
function resetRun() {
  beaconIndex = 0; lives = 3; elapsed = 0; state = "play"; courier.x = 320; courier.y = 460; courier.invuln = 2;
  drones.forEach((d, i) => { d.x = 500 + i * 360; d.y = 180 + (i * 157) % 600; });
  Camera.snap();
}
function hitCourier(d) {
  lives--; courier.invuln = 2; Sfx.hit(); UI.float("DAMAGE", courier.x, courier.y - 24, { color: "#ff6b6b" });
  d.x = courier.x + 180; d.y = courier.y - 140; courier.x = Math.max(40, courier.x - 100);
  fx.burst({ at: courier, count: 24, color: ["#ff6b6b", "#ffe066"], speed: [0.7, 3], life: [250, 700] });
  if (lives <= 0) { state = "lost"; Sfx.lose(); }
}
// The default camera: follow the courier inside a dead-zone, clamped to the
// world. It reads the live viewport itself — nothing to rebind on resize.
Camera.follow(courier, { world: { w: worldW, h: worldH }, damping: 0.1, deadzone: { w: 220, h: 120 } });
Camera.snap();

// Columns visible under a parallax layer. `Camera.layer(factor, ...)` shifts
// drawing by -Camera pos · factor · zoom, so column i (at x = i·spacing) is
// on screen when i·spacing − offset ∈ [0, view.w]; the column x doubles as a
// stable per-column seed (no shimmering when the camera moves).
function eachColumn(factor, spacing, cb, pad = 2) {
  const off = Camera.x * factor * Camera.zoom;
  const first = Math.floor(off / spacing) - pad;
  const last = Math.ceil((off + view.w) / spacing) + pad;
  const base = view.h + Camera.y * factor * Camera.zoom; // screen-bottom anchor
  for (let i = first; i <= last; i++) cb(i * spacing, i * spacing, base);
}

Loop.run({
  update() {
    courier.invuln = Math.max(0, courier.invuln - STEP_S);
    // Named actions keep the controls readable and support arrows + WASD.
    const dx = input.axis("left", "right");
    const dy = input.axis("up", "down");
    const len = Math.hypot(dx, dy) || 1;
    if (state === "play") {
      elapsed += STEP_S;
      if (dx || dy) courier.angle = Math.atan2(dy, dx);
      courier.x = Mathf.clamp(courier.x + dx / len * courier.speed, 24, worldW - 24);
      courier.y = Mathf.clamp(courier.y + dy / len * courier.speed, 24, worldH - 24);
      for (const d of drones) {
        const a = Math.atan2(courier.y - d.y, courier.x - d.x) + Math.sin(elapsed + d.phase) * .8;
        const sp = (18 + d.phase * 2) / 60; // px/step
        d.x += Math.cos(a) * sp; d.y += Math.sin(a) * sp;
        if (courier.invuln <= 0 && Math.hypot(courier.x - d.x, courier.y - d.y) < courier.r + 12) {
          hitCourier(d); break;
        }
      }
      const beacon = beacons[beaconIndex];
      if (Pointer.pressed) {
        const wp = Camera.toWorld(Pointer); // mouse picking, one call
        if (Math.hypot(wp.x - beacon.x, wp.y - beacon.y) < 80 && Math.hypot(courier.x - beacon.x, courier.y - beacon.y) < 115) {
          fx.burst({ at: beacon, count: 50, color: ["#ffe066", "#4ecdc4", "#b197fc"], speed: [1.3, 5], life: [500, 1000], gravity: 0.03 });
          Sfx.pickup(); UI.float("DOCKED", beacon.x, beacon.y - 38, { color: "#64f0c8" });
          beaconIndex++; if (beaconIndex >= beacons.length) { state = "won"; Sfx.win(); }
        }
      }
      if (Keys.pressed("KeyR")) resetRun();
    } else if (Keys.pressed("KeyR")) resetRun();
    if (Keys.pressed("Equal") || Keys.pressed("NumpadAdd")) Camera.zoom = Mathf.clamp(Camera.zoom + 0.1, 0.65, 1.7);
    if (Keys.pressed("Minus") || Keys.pressed("NumpadSubtract")) Camera.zoom = Mathf.clamp(Camera.zoom - 0.1, 0.65, 1.7);
  },
  draw() {
    const { ctx } = Draw;
    // Far mountains + mid ridges: parallax layers with stable world-column
    // seeds — no shimmering at wrap points.
    Camera.layer(0.12, () => {
      eachColumn(0.12, 130, (x, seed, base) => {
        const h = 70 + Math.abs(Math.sin(seed * 0.017)) * 100;
        ctx.fillStyle = "#121b3b"; ctx.beginPath(); ctx.moveTo(x, base); ctx.lineTo(x + 70, base - h); ctx.lineTo(x + 140, base); ctx.fill();
      });
    });
    Camera.layer(0.3, () => {
      eachColumn(0.3, 86, (x, seed, base) => {
        const h = 30 + Math.abs(Math.sin(seed * 0.041 + 2)) * 60;
        Draw.rect(x, base - h, 50, h, "#192950");
      });
    });
    // The world pass — the camera transforms its block; screen space resumes
    // after it (HUD).
    Camera.render(() => {
      for (let x = 0; x <= worldW; x += 100) Draw.line(x, 0, x, worldH, "#182644", 2);
      for (let y = 0; y <= worldH; y += 100) Draw.line(0, y, worldW, y, "#182644", 2);
      Draw.rect(0, worldH - 80, worldW, 80, "#16233e");
      for (let i = 0; i < beacons.length; i++) {
        const b = beacons[i], done = i < beaconIndex, active = i === beaconIndex;
        ctx.strokeStyle = done ? "#64f0c8" : active ? "#ffe066" : "#405477"; ctx.lineWidth = active ? 3 : 2;
        ctx.beginPath(); ctx.arc(b.x, b.y, active ? 28 + Math.sin(performance.now() / 180) * 6 : 20, 0, Math.PI * 2); ctx.stroke();
        Draw.circle(b, 7, done ? "#64f0c8" : active ? "#ffe066" : "#405477");
        // World-space text = Draw.text (UI.text is ALWAYS screen space).
        Draw.text(done ? "DELIVERED" : active ? "DOCK HERE" : "LOCKED", { x: b.x - 38, y: b.y - 55, size: 13, color: "#fff" });
      }
      for (const d of drones) { ctx.save(); ctx.translate(d.x, d.y); ctx.rotate(Math.atan2(courier.y - d.y, courier.x - d.x)); ctx.fillStyle = "#ff6b6b"; ctx.strokeStyle = "#ffb199"; ctx.beginPath(); ctx.moveTo(11, 0); ctx.lineTo(-8, -7); ctx.lineTo(-4, 0); ctx.lineTo(-8, 7); ctx.closePath(); ctx.fill(); ctx.stroke(); ctx.restore(); }
      if (courier.invuln <= 0 || Math.floor(elapsed * 12) % 2) { ctx.save(); ctx.translate(courier.x, courier.y); ctx.rotate(courier.angle); ctx.fillStyle = "#142f43"; ctx.strokeStyle = "#64f0c8"; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(18, 0); ctx.lineTo(-11, -10); ctx.lineTo(-6, 0); ctx.lineTo(-11, 10); ctx.closePath(); ctx.fill(); ctx.stroke(); ctx.restore(); }
      UI.drawFloats(); // damage/docked pops live in world space
      Draw.particles(fx);
    });
    UI.panel({ x: 8, y: 7, w: 520, h: 42, bg: "rgba(8,11,24,.86)", border: "#30496e" });
    UI.text(`BEACONS ${beaconIndex}/${beacons.length}  LIVES ${"◆".repeat(Math.max(0, lives))}  TIME ${elapsed.toFixed(1)}s`, { x: 14, y: 8, size: 14, color: "#fff" });
    UI.bar(14, 32, 90, 7, lives / 3, { fill: "#64f0c8", bg: "#20344a" });
    UI.text("WASD / arrows to fly · click an in-range beacon · +/- zoom · R restart", { x: 14, y: 51, size: 14, color: "dim" });
    if (state !== "play") {
      Draw.rect(0, 0, view.w, view.h, "rgba(5,8,20,.78)");
      UI.text(state === "won" ? "DELIVERY COMPLETE" : "COURIER LOST", { x: view.w / 2, y: view.h / 2 - 40, size: 30, bold: true, color: state === "won" ? "#64f0c8" : "#ff6b6b", align: "center" });
      UI.text("Press R to run the route again", { x: view.w / 2, y: view.h / 2 + 10, size: 14, color: "#fff", align: "center" });
    }
  },
});
