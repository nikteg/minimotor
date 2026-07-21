// CHECKPOINT RALLY: drive a rigid-body car around a long winding circuit,
// hitting the numbered gates in order to complete laps and chasing your best
// lap time. A Physics2D (planck/Box2D) world integrates the car body while a
// Gizmos.car driving model steers it (throttle/brake/steer/handbrake → drift).
// Smooth road-edge walls keep the car on the circuit; there are no mid-track
// obstacles. Focus: Gizmos.car (drives an injected physics body), Physics2D,
// Camera.createCamera (dead-zone follow) and Gizmos.checkpointRoute (gates/laps).
// Space = handbrake for drifts. A corner minimap sits below the HUD.
import { Minimotor } from "minimotor";
import { Physics2D } from "minimotor/physics2d";
const { Gizmos, Collision, Input, Loop, UI, Mathf, Camera, Draw, Audio, Keys } = Minimotor;
let vp = Minimotor.Stage.init("game", { plugins: [Minimotor.Perf.plugin()] });
const actions = Input.actions({ left: ["ArrowLeft", "KeyA"], right: ["ArrowRight", "KeyD"], gas: ["ArrowUp", "KeyW"], brake: ["ArrowDown", "KeyS"] });

// ---- The circuit: a smooth closed loop of waypoints across a large world. ----
const worldW = 3200, worldH = 2200;
const WP = 22;
const track = Array.from({ length: WP }, (_, i) => {
  const a = (i / WP) * Math.PI * 2;
  const rx = 1150 + Math.sin(a * 3) * 300;
  const ry = 780 + Math.cos(a * 2) * 240;
  return { x: worldW / 2 + Math.cos(a) * rx, y: worldH / 2 + Math.sin(a) * ry };
});
const ROAD_HW = 58; // half road width — the walls keep the car within this band
const gates = track.filter((_, i) => i % 3 === 0);
const route = Gizmos.checkpointRoute(gates.length);
const GATE_R = 62;

const MAX_SPEED = 360;
const CD_STEP = 900, GREEN_AT = CD_STEP * 3 + 400;

// ---- Physics world: just the car body. The road-edge WALLS are a smooth
// analytic soft-wall (below) rather than per-segment boxes — those thin boxes
// overlapped at corners and wedged the car. There are no mid-track obstacles.
const phys = Physics2D.world({ gravity: { x: 0, y: 0 }, pixelsPerMeter: 50 });
const body = phys.box(0, 0, 40, 22, { type: "dynamic", density: 1.35, friction: 0.25, restitution: 0.2, angularDamping: 1.6, bullet: true });

// Closest point on a segment a→b, then on the whole closed track polyline —
// the road centre line, used by the soft edge walls.
function closestOnSeg(px, py, a, b) {
  const dx = b.x - a.x, dy = b.y - a.y, len2 = dx * dx + dy * dy || 1;
  const t = Mathf.clamp(((px - a.x) * dx + (py - a.y) * dy) / len2, 0, 1);
  return { x: a.x + dx * t, y: a.y + dy * t };
}
function nearestOnTrack(px, py) {
  let best = Infinity, bx = px, by = py;
  for (let i = 0; i < track.length; i++) {
    const p = closestOnSeg(px, py, track[i], track[(i + 1) % track.length]);
    const d = Math.hypot(px - p.x, py - p.y);
    if (d < best) { best = d; bx = p.x; by = p.y; }
  }
  return { x: bx, y: by, dist: best };
}
const car = Gizmos.car(body, { acceleration: 900, grip: 7.5, steer: 0.8 });

const cam = Camera.createCamera({ worldW, worldH, viewW: vp.w, viewH: vp.h, damping: 0.12, deadZoneX: 0.14, deadZoneY: 0.14 });
cam.zoom = 0.85;
let engine = null;
let lapTime = 0, lastLap = 0, bestLap = 0, prevLap = 0, gateLock = -1;
let state = "countdown", cdTime = 0, redLit = 0, goFlash = 0;

function reset() {
  const start = track[WP - 1], ahead = track[0];
  body.x = start.x; body.y = start.y;
  body.rot = Math.atan2(ahead.y - start.y, ahead.x - start.x);
  body.vx = body.vy = body.spin = 0; body.wake();
  lapTime = 0; lastLap = 0; bestLap = 0; prevLap = 0; route.reset(); gateLock = -1;
  state = "countdown"; cdTime = 0; redLit = 0; goFlash = 0;
  cam.snapTo(body.x, body.y);
}
reset();
Minimotor.Stage.onResize((next) => { vp = next; cam.setView(vp.w, vp.h); });

Loop.run({
  update(stepMs) {
    if (state === "countdown") {
      cdTime += stepMs;
      body.vx = body.vy = body.spin = 0; // hold on the line
      const lit = Mathf.clamp(Math.floor(cdTime / CD_STEP) + 1, 1, 3);
      if (lit !== redLit) { redLit = lit; Audio.Sfx.blip(300, 0.08); }
      if (cdTime >= GREEN_AT) { state = "racing"; goFlash = 900; lapTime = 0; Audio.Sfx.blip(720, 0.12); }
      if (Keys.pressed("KeyR")) reset();
      cam.snapTo(body.x, body.y);
      return;
    }
    goFlash = Math.max(0, goFlash - stepMs);
    const dt = stepMs / 1000; lapTime += stepMs;
    const throttle = (actions.down("gas") ? 1 : 0) - (actions.down("brake") ? 1 : 0);
    const steer = (actions.down("right") ? 1 : 0) - (actions.down("left") ? 1 : 0);
    const handbrake = Keys.down("Space");
    // The car gizmo sets the body's tyre-space velocity; step integrates it.
    car.drive({ throttle, steer, handbrake }, dt);
    phys.step(stepMs);

    // Road-edge walls (smooth): if the car strays past the road half-width from
    // the centre line, slide it back to the edge and cancel the outward velocity
    // component — a clean wall you scrub along, with no corner pockets to snag on.
    const near = nearestOnTrack(body.x, body.y);
    if (near.dist > ROAD_HW) {
      const ux = (body.x - near.x) / near.dist, uy = (body.y - near.y) / near.dist;
      body.x = near.x + ux * ROAD_HW;
      body.y = near.y + uy * ROAD_HW;
      const outward = body.vx * ux + body.vy * uy;
      if (outward > 0) { body.vx -= outward * ux; body.vy -= outward * uy; }
    }

    // Gate progress: only the NEXT gate counts, on a fresh entry.
    let touching = -1;
    for (let i = 0; i < gates.length; i++) if (Collision.circleHit(body.x, body.y, 0, gates[i].x, gates[i].y, GATE_R)) touching = i;
    if (touching !== gateLock && touching === route.next && route.visit(touching)) Audio.Sfx.blip(440, 0.06);
    gateLock = touching;
    if (route.lap > prevLap) {
      lastLap = lapTime;
      if (!bestLap || lastLap < bestLap) bestLap = lastLap;
      lapTime = 0; prevLap = route.lap;
      Audio.Sfx.blip(660, 0.09);
    }

    if (!engine && (throttle || steer)) engine = Audio.engineSound({ idleHz: 42, revHz: 165, gears: 6, drive: 2.6, volume: 1.0 });
    if (engine) engine.update({ speed: car.speed, maxSpeed: MAX_SPEED, load: car.engineLoad, slip: Math.min(1, car.tireSlip / 220) });

    if (Keys.pressed("KeyR")) reset();
    cam.update(body.x, body.y, Draw.frameScale);
  },
  draw(ctx) {
    ctx.fillStyle = "#12161f"; ctx.fillRect(0, 0, vp.w, vp.h);
    ctx.save();
    ctx.translate(-cam.x * cam.zoom, -cam.y * cam.zoom);
    ctx.scale(cam.zoom, cam.zoom);

    ctx.strokeStyle = "#1b2331"; ctx.lineWidth = 2;
    for (let x = 0; x <= worldW; x += 200) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, worldH); ctx.stroke(); }
    for (let y = 0; y <= worldH; y += 200) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(worldW, y); ctx.stroke(); }

    strokeLoop(ctx, track, "#5a6675", (ROAD_HW + 7) * 2);
    strokeLoop(ctx, track, "#3a444f", ROAD_HW * 2);
    ctx.setLineDash([26, 30]); strokeLoop(ctx, track, "#c7d0dc", 3); ctx.setLineDash([]);

    gates.forEach((g, i) => {
      const next = i === route.next;
      ctx.strokeStyle = next ? "#ffe066" : "#4ecdc4"; ctx.lineWidth = 6;
      ctx.beginPath(); ctx.arc(g.x, g.y, GATE_R, 0, Math.PI * 2); ctx.stroke();
      UI.text(ctx, String(i + 1), { x: g.x - 18, y: g.y - 20, w: 36, h: 40, size: 34, bold: true, align: "center", color: next ? "#ffe066" : "#4ecdc4" });
    });

    ctx.save(); ctx.translate(body.x, body.y); ctx.rotate(body.rot);
    ctx.fillStyle = "#ff6b6b"; ctx.fillRect(-20, -11, 40, 22);
    ctx.fillStyle = "#fff"; ctx.fillRect(6, -6, 9, 12);
    ctx.restore();
    ctx.restore();

    const fmt = (ms) => ms ? `${(ms / 1000).toFixed(2)}s` : "—";
    UI.group({ x: 10, y: 10, w: 360, h: 60, title: "CHECKPOINT RALLY" }, (b) =>
      UI.text(`Lap ${route.lap}   This ${fmt(lapTime)}   Last ${fmt(lastLap)}   Best ${fmt(bestLap)}`, { h: b.remaining, size: 11 }));
    UI.text(ctx, "Arrows/WASD drive · Space handbrake · reach gates 1→N in order · R restart", { x: 12, y: vp.h - 28, size: 11, color: "dim" });

    drawMinimap(ctx);
    drawLights(ctx);
  },
});

function strokeLoop(ctx, pts, color, width) {
  ctx.strokeStyle = color; ctx.lineWidth = width; ctx.lineJoin = "round"; ctx.lineCap = "round";
  ctx.beginPath(); ctx.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
  ctx.closePath(); ctx.stroke();
}

function drawMinimap(ctx) {
  const MW = 200, MH = 138, ox = 10, oy = 80;
  const mx = (wx) => ox + (wx / worldW) * MW;
  const my = (wy) => oy + (wy / worldH) * MH;
  ctx.fillStyle = "rgba(8,12,20,.82)"; ctx.strokeStyle = "#30496e"; ctx.lineWidth = 1;
  ctx.fillRect(ox - 4, oy - 4, MW + 8, MH + 8); ctx.strokeRect(ox - 4, oy - 4, MW + 8, MH + 8);
  ctx.strokeStyle = "#4a5568"; ctx.lineWidth = 3; ctx.lineJoin = "round";
  ctx.beginPath(); ctx.moveTo(mx(track[0].x), my(track[0].y));
  for (let i = 1; i < track.length; i++) ctx.lineTo(mx(track[i].x), my(track[i].y));
  ctx.closePath(); ctx.stroke();
  gates.forEach((g, i) => {
    const next = i === route.next;
    ctx.fillStyle = next ? "#ffe066" : "#4ecdc4";
    ctx.beginPath(); ctx.arc(mx(g.x), my(g.y), next ? 4 : 2.5, 0, Math.PI * 2); ctx.fill();
  });
  ctx.fillStyle = "#ff6b6b"; ctx.beginPath(); ctx.arc(mx(body.x), my(body.y), 3.5, 0, Math.PI * 2); ctx.fill();
}

function drawLights(ctx) {
  const racing = state !== "countdown";
  if (racing && goFlash <= 0) return;
  const n = 3, r = 22, gap = 16, w = n * (r * 2) + (n - 1) * gap;
  const x0 = vp.w / 2 - w / 2, y = 74;
  ctx.fillStyle = "rgba(8,10,16,.9)"; ctx.fillRect(x0 - 16, y - r - 14, w + 32, r * 2 + 28);
  for (let i = 0; i < n; i++) {
    const cx = x0 + r + i * (r * 2 + gap);
    ctx.fillStyle = racing ? "#39d353" : (i < redLit ? "#ff4136" : "#3a1414");
    ctx.beginPath(); ctx.arc(cx, y, r, 0, Math.PI * 2); ctx.fill();
  }
  UI.text(ctx, racing ? "GO!" : "GET READY", { x: 0, y: y + r + 16, w: vp.w, size: 20, bold: true, align: "center", color: racing ? "#39d353" : "#ffe066" });
}
