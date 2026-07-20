// Rigid-body physics: the opt-in Physics2D adapter (planck / Box2D) driven by
// the fixed-step loop — composed with the ECS. Each body lives in a `Phys`
// component next to the built-in Sprite; a sync system copies the transform
// over each step, and world.drawSprites renders everything. No custom draw
// code for the bodies at all.
// Demonstrates: Physics2D.world/box/circle/walls/pin, onContact, deferred
// destroy, wake() on resize, the ECS body-in-a-component pattern, and the
// separate "minimotor/physics2d" entry (core stays dep-free).
import { Minimotor } from "minimotor";
import { Physics2D } from "minimotor/physics2d";

const { ECS, Pointer, Keys, Mathf, Camera, Audio, Sprites, Loop } = Minimotor;

const world = ECS.world();
const Phys = ECS.component("Phys"); // { body: Body2D }

let vp = Minimotor.Stage.init("game", {
  plugins: [Minimotor.Perf.plugin({ world })],
});

const phys = Physics2D.world(); // gravity 1800 px/s² down

// ---- pre-rendered textures (base 64px, scaled per body via Sprite w/h) ----
const TEX = 64;
const crateTex = (color) =>
  Sprites.getSprite(`crate-${color}`, TEX, vp.dpr, (c) => {
    c.fillStyle = color;
    c.fillRect(-TEX / 2, -TEX / 2, TEX, TEX);
    c.fillStyle = "rgba(255,255,255,0.18)";
    c.fillRect(-TEX / 2, -TEX / 2, TEX, 6);
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
let frame = phys.walls(0, 0, vp.w, vp.h, { friction: 0.4 });

const paddle = { w: 220, h: 14 };
const anchor = phys.box(vp.w / 2, vp.h * 0.55, 10, 10, { type: "static" });
const plank = phys.box(vp.w / 2, vp.h * 0.55, paddle.w, paddle.h, {
  density: 4,
  friction: 0.6,
});
const hinge = phys.pin(anchor, plank, vp.w / 2, vp.h * 0.55);
hinge.motor(1.5, 80000); // slow constant spin — flings whatever lands on it

Minimotor.Stage.onResize((next) => {
  vp = next;
  // Rebuild the frame for the new size…
  frame.destroy();
  frame = phys.walls(0, 0, vp.w, vp.h, { friction: 0.4 });
  // …keep the paddle hinged at the same relative spot (the joint's anchors are
  // body-local, so teleporting both bodies by the same delta moves the hinge)…
  const dx = vp.w / 2 - anchor.x;
  const dy = vp.h * 0.55 - anchor.y;
  for (const b of [anchor, plank]) {
    b.x += dx;
    b.y += dy;
  }
  // …and pull anything stranded outside back in. Everything gets a wake():
  // sleeping bodies don't notice the floor moving underneath them.
  for (const [, p] of world.query(Phys)) {
    p.body.x = Mathf.clamp(p.body.x, 30, vp.w - 30);
    p.body.y = Math.min(p.body.y, vp.h - 30);
    p.body.wake();
  }
});

// ---- dynamic bodies: a Phys component next to the built-in Sprite ----
const CRATE_COLORS = ["#ffa94d", "#ffd43b", "#ff6b6b"];

function spawnCrate(x, y) {
  const s = Mathf.randRange(24, 46);
  const body = phys.box(x, y, s, s, { friction: 0.5, restitution: 0.05, data: "crate" });
  body.rot = Mathf.randRange(0, Math.PI / 2);
  world.spawn(
    ECS.Sprite.with({ x, y, img: crateTex(Mathf.randItem(CRATE_COLORS)), w: s, h: s }),
    Phys.with({ body }),
  );
}

function spawnBall(x, y) {
  const r = Mathf.randRange(10, 20);
  const body = phys.circle(x, y, r, {
    friction: 0.3,
    restitution: 0.75,
    density: 0.6,
    data: "ball",
  });
  world.spawn(ECS.Sprite.with({ x, y, img: ballTex, w: r * 2, h: r * 2 }), Phys.with({ body }));
}

function reset() {
  for (const [e, p] of world.query(Phys)) {
    p.body.destroy();
    world.despawn(e);
  }
  world.flush();
  for (let i = 0; i < 8; i++) spawnCrate(Mathf.randRange(60, vp.w - 60), Mathf.randRange(0, 200));
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

// Physics ticks inside the ECS system order: step, then copy transforms into
// the sprites (position, rotation; sleeping bodies dim).
world.system("physics", () => phys.step(Loop.step));
world.system("sync", (w) => {
  for (const [e, s, p] of w.query(ECS.Sprite, Phys)) {
    s.x = p.body.x;
    s.y = p.body.y;
    s.rot = p.body.rot;
    s.alpha = p.body.awake ? 1 : 0.55;
    if (p.body.y > vp.h + 200) {
      // Resizing smaller can strand a body outside the frame — cull it.
      p.body.destroy();
      w.despawn(e);
    }
  }
});

let spawnTick = 0;

Minimotor.Loop.run({
  update() {
    // Hold to pour crates; shift-click (or X) pours balls instead.
    if (Pointer.down && spawnTick++ % 6 === 0) {
      if (Keys.down("ShiftLeft") || Keys.down("ShiftRight") || Keys.down("KeyX")) {
        spawnBall(Pointer.x, Pointer.y);
      } else {
        spawnCrate(Pointer.x, Pointer.y);
      }
    }
    if (Keys.pressed("KeyR")) reset();
    world.update(); // runs physics + sync systems, then flushes despawns
  },

  draw(ctx) {
    ctx.fillStyle = "#12141c";
    ctx.fillRect(0, 0, vp.w, vp.h);

    ctx.save();
    ctx.translate(Camera.shakeX(), Camera.shakeY());

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

    world.drawSprites(ctx); // every body, via the built-in renderer
    ctx.restore();

    ctx.fillStyle = "#fff";
    ctx.font = "14px monospace";
    ctx.fillText(`bodies: ${phys.count}`, 10, 20);
    ctx.fillStyle = "#8aa";
    ctx.fillText("hold to pour crates · +Shift/X balls · R reset", 10, vp.h - 10);
  },
});
