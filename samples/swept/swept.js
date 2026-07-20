// Swept collision demo: why Collision.sweptAABB beats a point-in-time overlap
// test for fast movers.
// Demonstrates: Minimotor.Collision.sweptAABB(box, dx, dy, target) vs
// rectsOverlap. A projectile flies right into a thin wall; at high speed a
// per-frame overlap test misses it entirely ("tunneling") while the swept test
// catches the crossing and reports where + on which face it hit.
//
// Controls:  Space = toggle method (swept ⇄ per-frame)   ↑/↓ = speed
import { Minimotor } from "minimotor";

let vp = Minimotor.Stage.init("game", { plugins: [Minimotor.Perf.plugin()] });
Minimotor.Stage.onResize((next) => (vp = next)); // wall/reset derive from vp
const { Collision, Keys, Loop } = Minimotor;

const midY = () => vp.h / 2;

// A thin wall in the middle of the screen — thin enough that a fast projectile
// steps clean over it in one frame.
const wall = () => ({ x: vp.w / 2 - 3, y: midY() - 90, w: 6, h: 180 });

const proj = { x: 0, y: 0, w: 18, h: 18 };
let speed = 60; // px per step; well above the wall's 6px width
let swept = true;
let stats = { hits: 0, tunneled: 0 };
let flash = null; // { x, y, tunneled } — last outcome marker, fades out
let flashAge = 0;

function reset() {
  proj.x = -proj.w;
  proj.y = midY() - proj.h / 2;
}
reset();

function box(x) {
  return { x, y: proj.y, w: proj.w, h: proj.h };
}

Loop.run({
  update() {
    if (Keys.pressed("Space")) swept = !swept;
    if (Keys.pressed("ArrowUp")) speed = Math.min(200, speed + 10);
    if (Keys.pressed("ArrowDown")) speed = Math.max(10, speed - 10);

    const prevX = proj.x;
    proj.x += speed;

    const w = wall();
    // Swept test uses the box's *start* position + this step's motion; the
    // per-frame test only sees the end position (and misses fast crossings).
    const hit = Collision.sweptAABB(box(prevX), speed, 0, w);
    const overlapNow = Collision.rectsOverlap(box(proj.x), w);

    const detected = swept ? hit !== null : overlapNow;
    // "Tunneled" = the projectile really did cross the wall this step, but the
    // active method failed to notice. The swept test is ground truth for that.
    const trulyCrossed = hit !== null;

    if (detected) {
      // Stop at the contact face. With the swept test we know exactly where
      // (start + motion·t); the per-frame test only knows "somewhere overlapping".
      const contactX = swept ? prevX + speed * hit.t : proj.x;
      stats.hits++;
      Minimotor.Audio.Sfx.blip(880, 0.05); // clean catch
      flash = { x: contactX + proj.w, y: proj.y + proj.h / 2, tunneled: false };
      flashAge = 0;
      reset();
    } else if (trulyCrossed) {
      // The projectile is now past the wall without a hit being registered.
      stats.tunneled++;
      Minimotor.Audio.Sfx.blip(120, 0.25); // the miss buzz
      flash = { x: w.x + w.w / 2, y: midY(), tunneled: true };
      flashAge = 0;
      reset();
    } else if (proj.x > vp.w) {
      reset();
    }

    flashAge++;
  },

  draw(ctx) {
    ctx.clearRect(0, 0, vp.w, vp.h);
    const w = wall();

    // Wall.
    ctx.fillStyle = "#4ecdc4";
    ctx.fillRect(w.x, w.y, w.w, w.h);

    // Projectile.
    ctx.fillStyle = "#ffe066";
    ctx.fillRect(proj.x, proj.y, proj.w, proj.h);

    // Outcome marker: green ring at the contact point, or a red "tunneled" mark.
    if (flash && flashAge < 40) {
      const a = 1 - flashAge / 40;
      ctx.globalAlpha = a;
      if (flash.tunneled) {
        ctx.strokeStyle = "#ff5252";
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(flash.x - 14, flash.y - 14);
        ctx.lineTo(flash.x + 14, flash.y + 14);
        ctx.moveTo(flash.x + 14, flash.y - 14);
        ctx.lineTo(flash.x - 14, flash.y + 14);
        ctx.stroke();
      } else {
        ctx.strokeStyle = "#6bff9e";
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(flash.x, flash.y, 16, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    }

    // HUD.
    ctx.fillStyle = "#fff";
    ctx.font = "16px monospace";
    ctx.fillText(`method: ${swept ? "sweptAABB" : "rectsOverlap (per-frame)"}`, 16, 28);
    ctx.fillText(`speed:  ${speed} px/step`, 16, 50);
    ctx.fillStyle = "#6bff9e";
    ctx.fillText(`hits: ${stats.hits}`, 16, 78);
    ctx.fillStyle = "#ff5252";
    ctx.fillText(`tunneled: ${stats.tunneled}`, 120, 78);
    ctx.fillStyle = "#888";
    ctx.font = "13px monospace";
    ctx.fillText("Space = toggle method    ↑/↓ = speed", 16, vp.h - 20);
    if (!swept && speed > proj.w) {
      ctx.fillStyle = "#ff5252";
      ctx.font = "14px monospace";
      ctx.fillText("↑ speed high enough to tunnel — watch the per-frame test miss", 16, 104);
    }
  },
});
