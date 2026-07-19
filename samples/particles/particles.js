// Particle system demo: firework sparks with gravity + sprite pre-rendering
// Demonstrates: game loop, physics (gravity), sprites (pre-rendered spark texture)
import { Minimotor } from "../../build/index.js";

Minimotor.Engine.use(Minimotor.Perf.plugin());

const vp = Minimotor.Engine.initCanvas("game");
const NUM = 200;
const SIZE = 8;

let sparks = [];

// Pre-render the spark texture once
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
    sparks.push({ x, y, vx: Math.cos(a) * speed, vy: Math.sin(a) * speed, life: 1 });
  }
}

// Click anywhere to spawn sparks
vp.canvas.addEventListener("click", (e) => {
  spawnBurst(e.offsetX, e.offsetY);
});
spawnBurst(vp.w / 2, vp.h / 2);

Minimotor.Engine.start(
  () => {
    const G = Minimotor.Physics.GRAVITY * 0.3;
    for (const s of sparks) {
      s.x += s.vx;
      s.y += s.vy;
      s.vy += G;
      s.life -= 0.008;
    }
    sparks = sparks.filter((s) => s.life > 0);
  },
  () => {
    const ctx = Minimotor.Engine.ctx;
    ctx.clearRect(0, 0, vp.w, vp.h);
    for (const s of sparks) {
      ctx.globalAlpha = s.life;
      ctx.drawImage(sparkCanvas, s.x - sparkCanvas.logicalSize / 2, s.y - sparkCanvas.logicalSize / 2);
    }
    ctx.globalAlpha = 1;
    ctx.fillStyle = "#fff";
    ctx.font = "14px monospace";
    ctx.fillText(`Sparks: ${sparks.length}  Click to spawn`, 10, 20);
  },
);
