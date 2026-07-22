// CLOCKWORK: a tiny arcade garden where everything is scheduled, animated and
// decoupled by engine services. Focus: Clock, Anim motions and Signals.
import { Anim, Clock, Draw, Gizmos, Keys, Loop, Mathf, Particles, Perf, Pointer, Signals, Stage, UI } from "minimotor";
import * as Sfx from "../../shared/src/sfx.js";

const vp = Stage.init("game", { background: "#0b1020", plugins: [Perf.plugin()] }); // live viewport

const fx = Particles.create();
const buds = [];
const hud = { score: 0, health: 5, elapsed: 0, message: "LISTEN FOR THE CHIME", messageAlpha: 1, pulse: 0 };
// A decaying combo (keep harvesting within the window or the streak drops) and
// a hit-flash for the "garden went quiet" damage blink.
const combo = Gizmos.combo({ windowMs: 3200 });
const damage = Gizmos.flash(320);
let spawnCount = 0, state = "play";
function resetRun() {
  buds.length = 0; hud.score = 0; combo.reset(); hud.health = 5; hud.elapsed = 0; hud.message = "THE GARDEN AWAKENS"; hud.messageAlpha = 1; state = "play"; spawnBud();
}

function spawnBud() {
  if (state !== "play") return;
  const b = {
    x: 36 + Math.random() * Math.max(1, vp.w - 72),
    y: 70 + Math.random() * Math.max(1, vp.h - 120),
    // scale + alpha both ride this one clock-derived motion (0 → 1 pop-in).
    grow: Anim.animate({ from: 0, to: 1, ms: 420, ease: Mathf.easeOut }),
    hue: 160 + Math.random() * 150,
    life: 8,
  };
  buds.push(b);
  spawnCount++;
}

// Game systems never touch the HUD directly: they announce facts instead.
Signals.on("harvest", (b) => {
  combo.hit();
  const bonus = 10 + (combo.count - 1) * 3;
  hud.score += bonus;
  UI.floatText(`+${bonus}`, b.x, b.y - 24, { color: "#ffe066" });
  hud.message = `HARVESTED +${bonus}`;
  hud.messageAlpha = 1;
  hud.pulse = 1;
  fx.burst({ at: b, count: 24, color: ["#4ecdc4", "#ffe066", "#b197fc"], speed: [50 / 60, 230 / 60], size: [2, 5], life: [300, 800], gravity: 160 / 3600 });
  Sfx.pickup();
});
Signals.on("miss", () => {
  if (state !== "play") return;
  combo.reset(); hud.health--; damage.hit();
  hud.message = hud.health > 0 ? "THE GARDEN WENT QUIET" : "THE GARDEN FELL SILENT";
  hud.messageAlpha = 1;
  Sfx.lose();
  if (hud.health <= 0) state = "gameover";
});

resetRun();
Clock.game.every(1050, spawnBud); // deterministic fixed-step rhythm
Clock.game.every(3000, () => {
  if (combo.count > 0) hud.message = `COMBO x${combo.count} — KEEP THE RHYTHM`;
});
Clock.game.every(8000, () => {
  // A repeating signal demonstrates that listeners can be swapped independently.
  Signals.emit("beat", { count: spawnCount });
});
Signals.on("beat", () => { hud.pulse = 0.6; });

Loop.run({
  update() {
    if (state === "gameover") {
      if (Keys.pressed("Space") || Pointer.pressed) resetRun();
      return;
    }
    hud.elapsed += 1 / 60;
    combo.tick(Loop.step);
    hud.messageAlpha = Math.max(0, hud.messageAlpha - 0.018);
    hud.pulse = Math.max(0, hud.pulse - 0.05);
    for (let i = buds.length - 1; i >= 0; i--) {
      const b = buds[i];
      b.life -= 1 / 60;
      if (b.life <= 0) { buds.splice(i, 1); Signals.emit("miss"); continue; }
      if (Pointer.pressed && Math.hypot(Pointer.x - b.x, Pointer.y - b.y) < 28 * b.grow.value) {
        buds.splice(i, 1); Signals.emit("harvest", b);
      }
    }
  },
  draw(ctx) {
    const t = performance.now() / 1000;
    ctx.strokeStyle = "rgba(98,160,190,.12)";
    for (let x = 0; x < vp.w; x += 32) { ctx.beginPath(); ctx.moveTo(x, 52); ctx.lineTo(x, vp.h); ctx.stroke(); }
    for (let y = 70; y < vp.h; y += 32) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(vp.w, y); ctx.stroke(); }
    for (const b of buds) {
      const wobble = 1 + Math.sin(t * 4 + b.x) * 0.08;
      const r = 19 * b.grow.value * wobble;
      ctx.save(); ctx.globalAlpha = b.grow.value; ctx.translate(b.x, b.y);
      ctx.fillStyle = `hsl(${b.hue} 80% 62%)`;
      ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "#fff8"; ctx.beginPath(); ctx.arc(-r * .3, -r * .3, r * .25, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    }
    Draw.particles(fx);
    UI.panel({ x: 7, y: 7, w: 430, h: 52, bg: "rgba(7,10,24,.82)", border: "#30496e" });
    UI.text(`SCORE ${hud.score}   COMBO x${combo.count}   TIME ${hud.elapsed.toFixed(1)}s`, { x: 14, y: 10, size: 16, bold: true, color: "#fff" });
    UI.text("GARDEN", { x: 14, y: 31, size: 16, bold: true, color: "#ff6b6b" });
    UI.bar(88, 41, 95, 8, hud.health / 5, { fill: "#ff6b6b", bg: "#3b2034" });
    UI.drawFloatText();
    UI.text("CLICK THE GLOWING BUDS · SPACE / click after game over to replay", { x: 14, y: 53, size: 12, color: "dim" });
    if (hud.messageAlpha > 0) { ctx.globalAlpha = hud.messageAlpha; UI.text(hud.message, { x: 14, y: vp.h - 40, size: 20, bold: true, color: "#ffe066" }); ctx.globalAlpha = 1; }
    if (hud.pulse > 0) { ctx.strokeStyle = `rgba(255,224,102,${hud.pulse})`; ctx.lineWidth = 3; ctx.strokeRect(5, 5, vp.w - 10, vp.h - 10); }
    // Hit flash: a red border that blinks and fades when the garden loses a bud.
    if (damage.active) { ctx.strokeStyle = `rgba(255,80,80,${damage.value})`; ctx.lineWidth = 10; ctx.strokeRect(5, 5, vp.w - 10, vp.h - 10); }
    if (state === "gameover") {
      ctx.fillStyle = "rgba(7,10,24,.82)"; ctx.fillRect(0, 0, vp.w, vp.h);
      UI.text("GARDEN SILENT", { x: vp.w / 2, y: vp.h / 2 - 52, size: 34, bold: true, color: "#ff6b6b", align: "center" });
      UI.text(`FINAL SCORE ${hud.score}`, { x: vp.w / 2, y: vp.h / 2 - 1, size: 15, color: "#fff", align: "center" });
      UI.text("SPACE or click to grow another run", { x: vp.w / 2, y: vp.h / 2 + 29, size: 13, color: "dim", align: "center" });
    }
  },
});
