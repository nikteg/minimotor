import { createPerformanceMonitoring } from "minimotor/performance";
// Swept collision demo: why Collision.sweptAABB beats a point-in-time overlap
// test for fast movers.
// Demonstrates: Collision.sweptAABB(box, dx, dy, target) vs rectsOverlap. A
// projectile flies right into a thin wall; at high speed a per-frame overlap
// test misses it entirely ("tunneling") while the swept test catches the
// crossing and reports where + on which face it hit.
//
// Controls:  Space = toggle method (swept ⇄ per-frame)   ↑/↓ = speed
import { createAudio } from "minimotor/audio";
import { createUI } from "minimotor/ui";
import { Collision, Mathf, App } from "minimotor";

// The viewport is LIVE (mutated on resize) — wall/reset derive from it; the
// engine owns clearing via `background`.
const game = App.create("game", {
  background: "#101418",
  preventNavigation: true,
});
createPerformanceMonitoring(game);
const view = game.viewport;
const { Draw, Keys, Loop } = game;
const Audio = createAudio(game);
const UI = createUI(game);

const midY = () => view.h / 2;

// A thin wall in the middle of the screen — thin enough that a fast projectile
// steps clean over it in one frame.
const wall = () => ({ x: view.w / 2 - 3, y: midY() - 90, w: 6, h: 180 });

const proj = { x: 0, y: 0, w: 18, h: 18 };
let speed = 60; // px per step; well above the wall's 6px width
let swept = true;
const stats = { hits: 0, tunneled: 0 };
let flash: { x: number; y: number; tunneled: boolean } | null = null; // last outcome marker, fades out
let flashAge = 0;

function reset() {
  proj.x = -proj.w;
  proj.y = midY() - proj.h / 2;
}
reset();

function box(x: number) {
  return { x, y: proj.y, w: proj.w, h: proj.h };
}

Loop.run({
  update() {
    if (Keys.pressed("Space")) swept = !swept;
    if (Keys.pressed("ArrowUp")) speed = Mathf.clamp(speed + 10, 10, 200);
    if (Keys.pressed("ArrowDown")) speed = Mathf.clamp(speed - 10, 10, 200);

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
      const contactX = swept ? prevX + speed * hit!.t : proj.x;
      stats.hits++;
      Audio.Sfx.blip(880, 0.05); // clean catch
      flash = { x: contactX + proj.w, y: proj.y + proj.h / 2, tunneled: false };
      flashAge = 0;
      reset();
    } else if (trulyCrossed) {
      // The projectile is now past the wall without a hit being registered.
      stats.tunneled++;
      Audio.Sfx.blip(120, 0.25); // the miss buzz
      flash = { x: w.x + w.w / 2, y: midY(), tunneled: true };
      flashAge = 0;
      reset();
    } else if (proj.x > view.w) {
      reset();
    }

    flashAge++;
  },

  draw() {
    Draw.rect(wall(), "#4ecdc4");
    Draw.rect(proj, "#ffe066");

    // Outcome marker: green ring at the contact point, or a red "tunneled"
    // mark. Stroked + fading shapes — the raw ctx escape hatch.
    if (flash && flashAge < 40) {
      const { ctx } = Draw;
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
    UI.text(`method: ${swept ? "sweptAABB" : "rectsOverlap (per-frame)"}`, {
      x: 16,
      y: 12,
      size: 16,
    });
    UI.text(`speed:  ${speed} px/step`, { x: 16, y: 34, size: 16 });
    UI.text(`hits: ${stats.hits}`, { x: 16, y: 62, size: 16, color: "#6bff9e" });
    UI.text(`tunneled: ${stats.tunneled}`, { x: 120, y: 62, size: 16, color: "#ff5252" });
    UI.text("Space = toggle method    ↑/↓ = speed", {
      x: 16,
      y: view.h - 33,
      size: 13,
      color: "dim",
    });
    if (!swept && speed > proj.w) {
      UI.text("↑ speed high enough to tunnel — watch the per-frame test miss", {
        x: 16,
        y: 90,
        size: 14,
        color: "#ff5252",
      });
    }
  },
});
