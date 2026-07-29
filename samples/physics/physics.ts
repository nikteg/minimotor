// Rigid-body physics: the opt-in Physics2D adapter (planck / Box2D) driven by
// the fixed-step loop — composed with the ECS. Each body lives in a `Phys`
// component next to a Sprites.Sprite; a sync system copies the transform
// over each step, and Draw.sprites(ecs.dense(Sprites.Sprite)) renders everything. No custom draw
// code for the bodies at all.
// Demonstrates: Physics2D.world/box/circle/walls/pin, onContact, deferred
// destroy, wake() on resize, drag() for grabbing a body with the pointer, the
// ECS body-in-a-component pattern, and the separate "minimotor/physics2d"
// entry (core stays dep-free).
import {
  Audio,
  Camera,
  Draw,
  ECS,
  Keys,
  Loop,
  Mathf,
  Perf,
  Pointer,
  Sprites,
  App,
  UI,
} from "minimotor";
import { Physics2D } from "minimotor/physics2d";
import type { Drag2D } from "minimotor/physics2d";

const ecs = ECS.create();
const { Phys } = Physics2D; // the standard body-holding component

let vp = App.init("game", {
  background: "#12141c",
  plugins: [Perf.plugin({ world: ecs })],
});

const phys = Physics2D.world(); // gravity 1800 px/s² down

// ---- pre-rendered textures (base 64px, scaled per body via Sprite w/h) ----
const TEX = 64;
const crateTex = (color: string) =>
  Sprites.getSprite(`crate-${color}`, TEX, vp.dpr, (c) => {
    c.fillStyle = color;
    c.fillRect(-TEX / 2, -TEX / 2, TEX, TEX);
    c.fillStyle = "rgba(255,255,255,0.18)";
    c.fillRect(-TEX / 2, -TEX / 2, TEX, 6);
  });
const wedgeTex = Sprites.getSprite("phys-wedge", TEX, vp.dpr, (c) => {
  c.fillStyle = "#63e6be";
  c.beginPath();
  c.moveTo(0, -TEX / 2);
  c.lineTo(TEX / 2, TEX / 2);
  c.lineTo(-TEX / 2, TEX / 2);
  c.closePath();
  c.fill();
});
const ballTex = Sprites.getSprite("phys-ball", TEX, vp.dpr, (c) => {
  c.fillStyle = "#4ecdc4";
  c.beginPath();
  c.arc(0, 0, TEX / 2, 0, Math.PI * 2);
  c.fill();
  c.strokeStyle = "rgba(0,0,0,0.35)"; // radius line makes spin visible
  c.lineWidth = 4;
  c.beginPath();
  c.moveTo(0, 0);
  c.lineTo(TEX / 2 - 2, 0);
  c.stroke();
});

// ---- static scene: walls + a motorized paddle hinged mid-screen ----
const frame = phys.walls(0, 0, vp.w, vp.h, { friction: 0.4 });

const paddle = { w: 220, h: 14 };
const anchor = phys.box(vp.w / 2, vp.h * 0.55, 10, 10, { type: "static" });
const plank = phys.box(vp.w / 2, vp.h * 0.55, paddle.w, paddle.h, {
  density: 4,
  friction: 0.6,
});
const hinge = phys.pin(anchor, plank, vp.w / 2, vp.h * 0.55);
hinge.motor(1.5, 80000); // slow constant spin — flings whatever lands on it

// A chain: zero-thickness scenery, the shape for terrain. Points are world px,
// so the ramp is literally the polyline we draw. It has no `set()` — rebuild it
// when the viewport changes.
let rampPoints: { x: number; y: number }[] = [];
let ramp = phys.chain([]);
function buildRamp() {
  ramp.destroy();
  rampPoints = [
    { x: 0, y: vp.h - 190 },
    { x: vp.w * 0.22, y: vp.h - 60 },
    { x: vp.w * 0.3, y: vp.h },
  ];
  ramp = phys.chain(rampPoints, { friction: 0.5 });
}
buildRamp();

// A rope pendulum: a distance joint holding a heavy ball under a fixed point.
// Grab it (drag works on any dynamic body) and swing it into the pile.
const hook = phys.box(vp.w * 0.8, 40, 8, 8, { type: "static" });
const wrecker = phys.circle(vp.w * 0.8, 40 + 160, 22, { density: 6, friction: 0.4 });
ecs.spawn(
  Sprites.Sprite.with({ x: wrecker.x, y: wrecker.y, img: ballTex, w: 44, h: 44 }),
  Phys.with({ body: wrecker }),
);
phys.rope(hook, wrecker);

App.onResize((next) => {
  vp = next;
  buildRamp();
  // The rope's anchors are body-local, so moving both ends keeps the hang.
  const hdx = vp.w * 0.8 - hook.x;
  hook.x += hdx;
  wrecker.x += hdx;
  wrecker.wake();
  // Re-target the frame: the kinematic walls glide to the new rect, sweeping
  // bodies ahead of them — everything pushes on everything else, no teleports.
  frame.set(0, 0, vp.w, vp.h);
  // Keep the paddle hinged at the same relative spot (the joint's anchors are
  // body-local, so moving both bodies by the same delta moves the hinge).
  const dx = vp.w / 2 - anchor.x;
  const dy = vp.h * 0.55 - anchor.y;
  for (const b of [anchor, plank]) {
    b.x += dx;
    b.y += dy;
  }
});

// ---- dynamic bodies: a Phys component next to a Sprites.Sprite ----
const CRATE_COLORS = ["#ffa94d", "#ffd43b", "#ff6b6b"];

function spawnCrate(x: number, y: number) {
  const s = Mathf.randRange(24, 46);
  const body = phys.box(x, y, s, s, { friction: 0.5, restitution: 0.05, data: "crate" });
  body.rot = Mathf.randRange(0, Math.PI / 2);
  ecs.spawn(
    Sprites.Sprite.with({ x, y, img: crateTex(Mathf.randItem(CRATE_COLORS)), w: s, h: s }),
    Phys.with({ body }),
  );
}

// A convex polygon body — the points are px offsets from its center, and the
// same triangle the texture draws.
function spawnWedge(x: number, y: number) {
  const s = Mathf.randRange(26, 44);
  const body = phys.polygon(
    x,
    y,
    [
      { x: 0, y: -s / 2 },
      { x: s / 2, y: s / 2 },
      { x: -s / 2, y: s / 2 },
    ],
    { friction: 0.5, restitution: 0.05, data: "wedge" },
  );
  body.rot = Mathf.randRange(0, Math.PI);
  ecs.spawn(Sprites.Sprite.with({ x, y, img: wedgeTex, w: s, h: s }), Phys.with({ body }));
}

function spawnBall(x: number, y: number) {
  const r = Mathf.randRange(10, 20);
  const body = phys.circle(x, y, r, {
    friction: 0.3,
    restitution: 0.75,
    density: 0.6,
    data: "ball",
  });
  ecs.spawn(Sprites.Sprite.with({ x, y, img: ballTex, w: r * 2, h: r * 2 }), Phys.with({ body }));
}

function reset() {
  for (const [e, p] of ecs.query(Phys)) {
    if (p.body === wrecker) continue; // the pendulum is scenery, not clutter
    p.body.destroy();
    ecs.despawn(e);
  }
  for (let i = 0; i < 8; i++) spawnCrate(Mathf.randRange(60, vp.w - 60), Mathf.randRange(0, 200));
  for (let i = 0; i < 4; i++) spawnWedge(Mathf.randRange(60, vp.w - 60), Mathf.randRange(0, 180));
  for (let i = 0; i < 5; i++) spawnBall(Mathf.randRange(60, vp.w - 60), Mathf.randRange(0, 150));
}
reset();

// Hard landings thump — gated by impact speed so resting contacts stay quiet.
phys.onContact((a, b) => {
  const speed = Math.hypot(a.vx - b.vx, a.vy - b.vy);
  if (speed > 400) {
    Camera.shake(Math.min(6, speed / 200), 130);
    Audio.Sfx.blip(Mathf.randRange(90, 140), 0.05, 0.1);
  }
});

// The ready-made binding: registers the step + sprite-sync systems (position
// and rotation — transforms only). Presentation is our own system on top:
// dim sleeping bodies so the solver's rest detection is visible.
Physics2D.attach(ecs, phys, { stepMs: Loop.step });
ecs.system("dim-sleepers", (w) => {
  for (const [, s, p] of w.query(Sprites.Sprite, Phys)) {
    s.alpha = p.body.awake ? 1 : 0.55;
  }
});

let spawnTick = 0;
let grab: Drag2D | null = null;

// ---- e2e hook ----
// The Playwright spec drags a real body across the canvas; it needs to know
// where the bodies are and whether a grab took. Harmless in normal use.
declare global {
  interface Window {
    __phys?: {
      bodies(): { x: number; y: number }[];
      grabbed(): boolean;
    };
  }
}
window.__phys = {
  bodies: () => [...ecs.query(Phys)].map(([, p]) => ({ x: p.body.x, y: p.body.y })),
  grabbed: () => grab !== null,
};

Loop.run({
  update() {
    // Press on a body to GRAB it (a spring, so it shoves the pile on the way);
    // press on empty space and hold to pour instead.
    if (Pointer.pressed) grab = phys.drag(Pointer.x, Pointer.y);
    if (grab) {
      grab.move(Pointer.x, Pointer.y);
      if (!Pointer.down) {
        grab.release();
        grab = null;
      }
    } else if (Pointer.down && spawnTick++ % 6 === 0) {
      // Hold to pour crates; shift-click (or X) pours balls instead.
      if (Keys.down("ShiftLeft") || Keys.down("ShiftRight") || Keys.down("KeyX")) {
        spawnBall(Pointer.x, Pointer.y);
      } else {
        spawnCrate(Pointer.x, Pointer.y);
      }
    }
    if (Keys.pressed("KeyR")) reset();
    ecs.update(); // runs physics + sync systems, then flushes despawns
  },

  draw(ctx) {
    // The default camera is identity — this block just applies the shake.
    Camera.render(() => {
      // Paddle — the one hand-drawn shape (no texture, just a rotated rect).
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

      Draw.sprites(ecs.dense(Sprites.Sprite)); // every body, via the built-in renderer

      // The drag spring, drawn so the grab reads as a rubber band.
      if (grab) Draw.line(grab.body.x, grab.body.y, Pointer.x, Pointer.y, "#ffd43b", 2);
    });

    UI.text(`bodies: ${phys.count}`, { x: 10, y: 6, size: 14 });
    UI.text("drag a body · hold empty space to pour · +Shift/X balls · R reset", {
      x: 10,
      y: vp.h - 24,
      size: 14,
      color: "dim",
    });
  },
});
