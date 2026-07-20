// Rigid-body physics: the opt-in Physics2D adapter (planck / Box2D) driven by
// the fixed-step loop. Real stacking, friction, restitution and a motorized
// joint — all addressed in pixels, drawn with plain ctx calls.
// Demonstrates: Physics2D.world/box/circle/walls/pin, onContact, deferred
// destroy, and the separate "minimotor/physics2d" entry (core stays dep-free).
import { Minimotor } from "minimotor";
import { Physics2D } from "minimotor/physics2d";

const { Pointer, Keys, Mathf, Camera, Audio } = Minimotor;

let vp = Minimotor.Stage.init("game", {
  plugins: [Minimotor.Perf.plugin()],
});

const phys = Physics2D.world(); // gravity 1800 px/s² down

// ---- static scene: walls + a motorized paddle in the middle ----
let frame = phys.walls(0, 0, vp.w, vp.h, { friction: 0.4 });
Minimotor.Stage.onResize((next) => {
  vp = next;
  frame.destroy(); // rebuild the frame for the new size
  frame = phys.walls(0, 0, vp.w, vp.h, { friction: 0.4 });
});

const paddle = { w: 220, h: 14 };
const anchor = phys.box(vp.w / 2, vp.h * 0.55, 10, 10, { type: "static" });
const plank = phys.box(vp.w / 2, vp.h * 0.55, paddle.w, paddle.h, {
  density: 4,
  friction: 0.6,
});
const hinge = phys.pin(anchor, plank, vp.w / 2, vp.h * 0.55);
hinge.motor(1.5, 80000); // slow constant spin — flings whatever lands on it

// ---- dynamic bodies, tagged for drawing ----
const CRATE_COLORS = ["#ffa94d", "#ffd43b", "#ff6b6b"];
const bodies = []; // our draw list: { body, kind, size, color }

function spawnCrate(x, y) {
  const s = Mathf.randRange(24, 46);
  const body = phys.box(x, y, s, s, {
    friction: 0.5,
    restitution: 0.05,
    data: "crate",
  });
  body.rot = Mathf.randRange(0, Math.PI / 2);
  bodies.push({ body, kind: "crate", size: s, color: Mathf.randItem(CRATE_COLORS) });
}

function spawnBall(x, y) {
  const r = Mathf.randRange(10, 20);
  const body = phys.circle(x, y, r, {
    friction: 0.3,
    restitution: 0.75,
    density: 0.6,
    data: "ball",
  });
  bodies.push({ body, kind: "ball", size: r, color: "#4ecdc4" });
}

function reset() {
  for (const e of bodies) e.body.destroy();
  bodies.length = 0;
  for (let i = 0; i < 8; i++) spawnCrate(Mathf.randRange(60, vp.w - 60), Mathf.randRange(0, 200));
  for (let i = 0; i < 5; i++) spawnBall(Mathf.randRange(60, vp.w - 60), Mathf.randRange(0, 150));
}
reset();

// Hard landings thump — impulse-free contact hook, gated by impact speed.
phys.onContact((a, b) => {
  const speed = Math.hypot(a.vx - b.vx, a.vy - b.vy);
  if (speed > 400) {
    Camera.shake(Math.min(6, speed / 200), 130);
    Audio.Sfx.blip(Mathf.randRange(90, 140), 0.05, 0.1);
  }
});

let spawnTick = 0;

Minimotor.Loop.run({
  update(stepMs) {
    // Hold to pour crates; shift-click (or X) pours balls instead.
    if (Pointer.down && spawnTick++ % 6 === 0) {
      if (Keys.down("ShiftLeft") || Keys.down("ShiftRight") || Keys.down("KeyX")) {
        spawnBall(Pointer.x, Pointer.y);
      } else {
        spawnCrate(Pointer.x, Pointer.y);
      }
    }
    if (Keys.pressed("KeyR")) reset();

    phys.step(stepMs);

    // Anything asleep and off-screen (shouldn't happen with walls, but resizing
    // smaller can strand bodies outside) gets culled.
    for (let i = bodies.length - 1; i >= 0; i--) {
      const { body } = bodies[i];
      if (body.y > vp.h + 200) {
        body.destroy();
        bodies.splice(i, 1);
      }
    }
  },

  draw(ctx) {
    ctx.fillStyle = "#12141c";
    ctx.fillRect(0, 0, vp.w, vp.h);

    ctx.save();
    ctx.translate(Camera.shakeX(), Camera.shakeY());

    // Paddle
    ctx.save();
    ctx.translate(plank.x, plank.y);
    ctx.rotate(plank.rot);
    ctx.fillStyle = "#b197fc";
    ctx.fillRect(-paddle.w / 2, -paddle.h / 2, paddle.w, paddle.h);
    ctx.restore();
    ctx.fillStyle = "#7d8894";
    ctx.beginPath();
    ctx.arc(anchor.x, anchor.y, 5, 0, Math.PI * 2);
    ctx.fill();

    // Bodies — sleeping ones dim, so the solver's rest detection is visible.
    for (const { body, kind, size, color } of bodies) {
      ctx.save();
      ctx.translate(body.x, body.y);
      ctx.rotate(body.rot);
      ctx.globalAlpha = body.awake ? 1 : 0.55;
      ctx.fillStyle = color;
      if (kind === "crate") {
        ctx.fillRect(-size / 2, -size / 2, size, size);
        ctx.fillStyle = "rgba(255,255,255,0.18)";
        ctx.fillRect(-size / 2, -size / 2, size, 4);
      } else {
        ctx.beginPath();
        ctx.arc(0, 0, size, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = "rgba(0,0,0,0.35)"; // radius line makes spin visible
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(size, 0);
        ctx.stroke();
      }
      ctx.restore();
    }
    ctx.restore();

    ctx.fillStyle = "#fff";
    ctx.font = "14px monospace";
    ctx.fillText(`bodies: ${phys.count}`, 10, 20);
    ctx.fillStyle = "#8aa";
    ctx.fillText("hold to pour crates · +Shift/X balls · R reset", 10, vp.h - 10);
  },
});
