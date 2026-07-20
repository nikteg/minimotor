// PARALLAX COURIER: deliver a signal through a huge neon valley.
// Focus: Camera.createCamera (follow, dead-zone, zoom, screen↔world mapping)
// and Camera.scrollColumns for stable procedural parallax scenery.
import { Minimotor } from "minimotor";
import * as Sfx from "../shared/sfx.js";

let vp = Minimotor.Stage.init("game", { plugins: [Minimotor.Perf.plugin()] });
const { Camera, Input, Mathf, Pointer, Draw, Loop, Particles, UI } = Minimotor;
const input = Input.actions({ left: ["ArrowLeft", "KeyA"], right: ["ArrowRight", "KeyD"], up: ["ArrowUp", "KeyW"], down: ["ArrowDown", "KeyS"] });
const worldW = 3600, worldH = 900;
const cam = Camera.createCamera({ worldW, worldH, viewW: vp.w, viewH: vp.h, damping: 0.1, deadZoneX: 0.18, deadZoneY: 0.12 });
const courier = { x: 320, y: 460, r: 16, speed: 260, angle: 0, invuln: 0 };
const beacons = [{ x: 900, y: 260 }, { x: 1900, y: 680 }, { x: 2900, y: 300 }];
const drones = Array.from({ length: 9 }, (_, i) => ({ x: 500 + i * 360, y: 180 + (i * 157) % 600, phase: i * 1.7 }));
let beaconIndex = 0, lives = 3, elapsed = 0, state = "play";
function resetRun() {
  beaconIndex = 0; lives = 3; elapsed = 0; state = "play"; courier.x = 320; courier.y = 460; courier.invuln = 2;
  drones.forEach((d, i) => { d.x = 500 + i * 360; d.y = 180 + (i * 157) % 600; });
}
function hitCourier(d) { lives--; courier.invuln = 2; Sfx.hit(); UI.float("DAMAGE", courier.x, courier.y - 24, { color: "#ff6b6b" }); d.x = courier.x + 180; d.y = courier.y - 140; courier.x = Math.max(40, courier.x - 100); Particles.burst(courier.x, courier.y, { count: 24, colors: ["#ff6b6b", "#ffe066"], speed: [40, 180], life: [250, 700] }); if (lives <= 0) { state = "lost"; Sfx.lose(); } }
cam.snapTo(courier.x, courier.y);
Minimotor.Stage.onResize((next) => { vp = next; cam.setView(vp.w, vp.h); });

Loop.run({
  update(stepMs) {
    const dt = stepMs / 1000;
    courier.invuln = Math.max(0, courier.invuln - dt);
    // Named actions keep the controls readable and support arrows + WASD.
    const dx = (input.down("right") ? 1 : 0) - (input.down("left") ? 1 : 0);
    const dy = (input.down("down") ? 1 : 0) - (input.down("up") ? 1 : 0);
    const len = Math.hypot(dx, dy) || 1;
    if (state === "play") {
      elapsed += dt;
      if (dx || dy) courier.angle = Math.atan2(dy, dx);
      courier.x = Mathf.clamp(courier.x + dx / len * courier.speed * dt, 24, worldW - 24);
      courier.y = Mathf.clamp(courier.y + dy / len * courier.speed * dt, 24, worldH - 24);
      for (const d of drones) {
        const a = Math.atan2(courier.y - d.y, courier.x - d.x) + Math.sin(elapsed + d.phase) * .8;
        d.x += Math.cos(a) * (18 + d.phase * 2) * dt; d.y += Math.sin(a) * (18 + d.phase * 2) * dt;
        if (courier.invuln <= 0 && Math.hypot(courier.x - d.x, courier.y - d.y) < courier.r + 12) {
          hitCourier(d); break;
        }
      }
      const beacon = beacons[beaconIndex];
      if (Pointer.pressed) {
        const wx = cam.wx(Pointer.x), wy = cam.wy(Pointer.y);
        if (Math.hypot(wx - beacon.x, wy - beacon.y) < 80 && Math.hypot(courier.x - beacon.x, courier.y - beacon.y) < 115) {
          Particles.burst(beacon.x, beacon.y, { count: 50, colors: ["#ffe066", "#4ecdc4", "#b197fc"], speed: [80, 300], life: [500, 1000], gravity: 100 });
          Sfx.pickup(); UI.float("DOCKED", beacon.x, beacon.y - 38, { color: "#64f0c8" });
          beaconIndex++; if (beaconIndex >= beacons.length) { state = "won"; Sfx.win(); }
        }
      }
      if (Minimotor.Keys.pressed("KeyR")) resetRun();
    } else if (Minimotor.Keys.pressed("KeyR")) resetRun();
    if (Minimotor.Keys.pressed("Equal") || Minimotor.Keys.pressed("NumpadAdd")) cam.zoom = Mathf.clamp(cam.zoom + 0.1, 0.65, 1.7);
    if (Minimotor.Keys.pressed("Minus") || Minimotor.Keys.pressed("NumpadSubtract")) cam.zoom = Mathf.clamp(cam.zoom - 0.1, 0.65, 1.7);
    cam.update(courier.x, courier.y, Draw.frameScale);
  },
  draw(ctx) {
    ctx.fillStyle = "#080b18"; ctx.fillRect(0, 0, vp.w, vp.h);
    // Far mountains use a stable world-column seed: no shimmering at wrap points.
    Camera.scrollColumns(cam.x * 0.12, 130, vp.w, (sx, seed) => {
      const h = 70 + Math.abs(Math.sin(seed * 0.017)) * 100;
      ctx.fillStyle = "#121b3b"; ctx.beginPath(); ctx.moveTo(sx, vp.h); ctx.lineTo(sx + 70, vp.h - h); ctx.lineTo(sx + 140, vp.h); ctx.fill();
    }, 2);
    Camera.scrollColumns(cam.x * 0.3, 86, vp.w, (sx, seed) => {
      const h = 30 + Math.abs(Math.sin(seed * 0.041 + 2)) * 60;
      ctx.fillStyle = "#192950"; ctx.fillRect(sx, vp.h - h, 50, h);
    }, 2);
    ctx.save();
    ctx.translate(-cam.x * cam.zoom, -cam.y * cam.zoom);
    ctx.scale(cam.zoom, cam.zoom);
    ctx.strokeStyle = "#182644"; ctx.lineWidth = 2;
    for (let x = 0; x <= worldW; x += 100) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, worldH); ctx.stroke(); }
    for (let y = 0; y <= worldH; y += 100) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(worldW, y); ctx.stroke(); }
    ctx.fillStyle = "#16233e"; ctx.fillRect(0, worldH - 80, worldW, 80);
    for (let i = 0; i < beacons.length; i++) {
      const b = beacons[i], done = i < beaconIndex, active = i === beaconIndex;
      ctx.strokeStyle = done ? "#64f0c8" : active ? "#ffe066" : "#405477"; ctx.lineWidth = active ? 3 : 2;
      ctx.beginPath(); ctx.arc(b.x, b.y, active ? 28 + Math.sin(performance.now() / 180) * 6 : 20, 0, Math.PI * 2); ctx.stroke();
      ctx.fillStyle = done ? "#64f0c8" : active ? "#ffe066" : "#405477"; ctx.beginPath(); ctx.arc(b.x, b.y, 7, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "#fff"; ctx.font = "13px monospace"; ctx.fillText(done ? "DELIVERED" : active ? "DOCK HERE" : "LOCKED", b.x - 38, b.y - 42);
    }
    for (const d of drones) { ctx.save(); ctx.translate(d.x, d.y); ctx.rotate(Math.atan2(courier.y - d.y, courier.x - d.x)); ctx.fillStyle = "#ff6b6b"; ctx.strokeStyle = "#ffb199"; ctx.beginPath(); ctx.moveTo(11, 0); ctx.lineTo(-8, -7); ctx.lineTo(-4, 0); ctx.lineTo(-8, 7); ctx.closePath(); ctx.fill(); ctx.stroke(); ctx.restore(); }
    if (courier.invuln <= 0 || Math.floor(elapsed * 12) % 2) { ctx.save(); ctx.translate(courier.x, courier.y); ctx.rotate(courier.angle); ctx.fillStyle = "#142f43"; ctx.strokeStyle = "#64f0c8"; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(18, 0); ctx.lineTo(-11, -10); ctx.lineTo(-6, 0); ctx.lineTo(-11, 10); ctx.closePath(); ctx.fill(); ctx.stroke(); ctx.restore(); }
    UI.drawFloats(ctx);
    Particles.draw(ctx);
    ctx.restore();
    UI.panel(ctx, { x: 8, y: 7, w: 520, h: 42, bg: "rgba(8,11,24,.86)", border: "#30496e" });
    ctx.fillStyle = "#fff"; ctx.font = "14px monospace"; ctx.fillText(`BEACONS ${beaconIndex}/${beacons.length}  LIVES ${"◆".repeat(Math.max(0, lives))}  TIME ${elapsed.toFixed(1)}s`, 14, 22);
    UI.bar(ctx, 14, 32, 90, 7, lives / 3, { fill: "#64f0c8", bg: "#20344a" });
    ctx.fillStyle = "#8da1c2"; ctx.fillText("WASD / arrows to fly · click an in-range beacon · +/- zoom · R restart", 14, 65);
    if (state !== "play") { ctx.fillStyle = "rgba(5,8,20,.78)"; ctx.fillRect(0, 0, vp.w, vp.h); ctx.fillStyle = state === "won" ? "#64f0c8" : "#ff6b6b"; ctx.font = "bold 30px monospace"; ctx.textAlign = "center"; ctx.fillText(state === "won" ? "DELIVERY COMPLETE" : "COURIER LOST", vp.w / 2, vp.h / 2 - 10); ctx.fillStyle = "#fff"; ctx.font = "14px monospace"; ctx.fillText("Press R to run the route again", vp.w / 2, vp.h / 2 + 24); ctx.textAlign = "left"; }
  },
});
