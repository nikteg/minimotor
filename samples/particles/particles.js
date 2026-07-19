// Particle system demo: firework sparks built on the ECS.
// Demonstrates: ECS (components, spawn, query, despawn), sprites, physics.
import { Minimotor } from "minimotor";

const vp = Minimotor.Stage.init("game", { plugins: [Minimotor.Perf.plugin()] });
const { ECS, Pointer, Draw } = Minimotor;

const NUM = 200;
const SIZE = 8;

// Components are plain-data; the world owns their storage.
const Pos = ECS.component("Pos"); //  { x, y }
const Vel = ECS.component("Vel"); //  { x, y }
const Life = ECS.component("Life"); // { v }  (1 → 0)

const world = ECS.world();

// Pre-render the spark texture once.
const sparkCanvas = Minimotor.Sprites.getSprite("spark", SIZE * 3, vp.dpr, (ctx) => {
  const g = ctx.createRadialGradient(0, 0, 0, 0, 0, SIZE);
  g.addColorStop(0, "rgba(255,255,200,1)");
  g.addColorStop(0.3, "rgba(255,150,50,0.8)");
  g.addColorStop(1, "rgba(255,50,20,0)");
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(0, 0, SIZE, 0, Math.PI * 2);
  ctx.fill();
});

function spawnBurst(x, y) {
  for (let i = 0; i < NUM; i++) {
    const a = Math.random() * Math.PI * 2;
    const speed = 1 + Math.random() * 5;
    world.spawn(
      Pos.with({ x, y }),
      Vel.with({ x: Math.cos(a) * speed, y: Math.sin(a) * speed }),
      Life.with({ v: 1 }),
    );
  }
}

spawnBurst(vp.w / 2, vp.h / 2);

Minimotor.Loop.run({
  update() {
    // Click/tap anywhere to spawn sparks (pointer is polled, no listeners).
    if (Pointer.pressed) spawnBurst(Pointer.x, Pointer.y);

    const G = Minimotor.Physics.GRAVITY * 0.3;
    // Despawning inside the loop is safe — the world buffers it until the
    // query finishes, so we never mutate the set mid-walk.
    for (const [e, p, v, life] of world.query(Pos, Vel, Life)) {
      p.x += v.x;
      p.y += v.y;
      v.y += G;
      life.v -= 0.008;
      if (life.v <= 0) world.despawn(e);
    }
  },
  draw() {
    const { ctx } = Draw;
    ctx.clearRect(0, 0, vp.w, vp.h);
    const half = sparkCanvas.logicalSize / 2;
    for (const [, p, life] of world.query(Pos, Life)) {
      ctx.globalAlpha = life.v;
      ctx.drawImage(sparkCanvas, p.x - half, p.y - half);
    }
    ctx.globalAlpha = 1;
    ctx.fillStyle = "#fff";
    ctx.font = "14px monospace";
    ctx.fillText(`Sparks: ${world.count(Pos)}  Click to spawn`, 10, 20);
  },
});
