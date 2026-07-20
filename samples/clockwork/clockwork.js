// CLOCKWORK: a tiny arcade garden where everything is scheduled, animated and
// decoupled by engine services. Focus: Clock, Tween and Signals.
import { Minimotor } from "minimotor";
import * as Sfx from "../shared/sfx.js";

let vp = Minimotor.Stage.init("game", { plugins: [Minimotor.Perf.plugin()] });
Minimotor.Stage.onResize((next) => (vp = next));
const { Loop, Pointer, Keys, Clock, Tween, Signals, Mathf, Particles, UI } = Minimotor;

const buds = [];
const hud = { score: 0, combo: 0, health: 5, elapsed: 0, message: "LISTEN FOR THE CHIME", messageAlpha: 1, pulse: 0 };
let spawnCount = 0, state = "play";
function resetRun() {
  buds.length = 0; hud.score = 0; hud.combo = 0; hud.health = 5; hud.elapsed = 0; hud.message = "THE GARDEN AWAKENS"; hud.messageAlpha = 1; state = "play"; spawnBud();
}

function spawnBud() {
  if (state !== "play") return;
  const b = {
    x: 36 + Math.random() * Math.max(1, vp.w - 72),
    y: 70 + Math.random() * Math.max(1, vp.h - 120),
    scale: 0,
    alpha: 0,
    hue: 160 + Math.random() * 150,
    life: 8,
  };
  buds.push(b);
  Tween.to(b, { scale: 1, alpha: 1 }, 420, Mathf.easeOut);
  spawnCount++;
}

// Game systems never touch the HUD directly: they announce facts instead.
Signals.on("harvest", (b) => {
  hud.score += 10 + hud.combo * 3;
  UI.float(`+${10 + (hud.combo * 3)}`, b.x, b.y - 24, { color: "#ffe066" });
  hud.combo++;
  hud.message = `HARVESTED +${10 + (hud.combo - 1) * 3}`;
  hud.messageAlpha = 1;
  hud.pulse = 1;
  Particles.burst(b.x, b.y, { count: 24, colors: ["#4ecdc4", "#ffe066", "#b197fc"], speed: [50, 230], size: [2, 5], life: [300, 800], gravity: 160 });
  Sfx.pickup();
});
Signals.on("miss", () => {
  if (state !== "play") return;
  hud.combo = 0; hud.health--;
  hud.message = hud.health > 0 ? "THE GARDEN WENT QUIET" : "THE GARDEN FELL SILENT";
  hud.messageAlpha = 1;
  Sfx.lose();
  if (hud.health <= 0) state = "gameover";
});

resetRun();
Clock.every(1050, spawnBud); // deterministic fixed-step rhythm
Clock.every(3000, () => {
  if (hud.combo > 0) hud.message = `COMBO x${hud.combo} — KEEP THE RHYTHM`;
});
Clock.every(8000, () => {
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
    hud.messageAlpha = Math.max(0, hud.messageAlpha - 0.018);
    hud.pulse = Math.max(0, hud.pulse - 0.05);
    for (let i = buds.length - 1; i >= 0; i--) {
      const b = buds[i];
      b.life -= 1 / 60;
      if (b.life <= 0) { buds.splice(i, 1); Signals.emit("miss"); continue; }
      if (Pointer.pressed && Math.hypot(Pointer.x - b.x, Pointer.y - b.y) < 28 * b.scale) {
        buds.splice(i, 1); Signals.emit("harvest", b);
      }
    }
  },
  draw(ctx) {
    ctx.fillStyle = "#0b1020";
    ctx.fillRect(0, 0, vp.w, vp.h);
    const t = performance.now() / 1000;
    ctx.strokeStyle = "rgba(98,160,190,.12)";
    for (let x = 0; x < vp.w; x += 32) { ctx.beginPath(); ctx.moveTo(x, 52); ctx.lineTo(x, vp.h); ctx.stroke(); }
    for (let y = 70; y < vp.h; y += 32) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(vp.w, y); ctx.stroke(); }
    for (const b of buds) {
      const wobble = 1 + Math.sin(t * 4 + b.x) * 0.08;
      const r = 19 * b.scale * wobble;
      ctx.save(); ctx.globalAlpha = b.alpha; ctx.translate(b.x, b.y);
      ctx.fillStyle = `hsl(${b.hue} 80% 62%)`;
      ctx.beginPath(); ctx.arc(0, 0, r, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "#fff8"; ctx.beginPath(); ctx.arc(-r * .3, -r * .3, r * .25, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
    }
    Particles.draw(ctx);
    UI.panel(ctx, { x: 7, y: 7, w: 430, h: 52, bg: "rgba(7,10,24,.82)", border: "#30496e" });
    ctx.fillStyle = "#fff"; ctx.font = "bold 16px monospace";
    ctx.fillText(`SCORE ${hud.score}   COMBO x${hud.combo}   TIME ${hud.elapsed.toFixed(1)}s`, 14, 26);
    ctx.fillStyle = "#ff6b6b"; ctx.fillText("GARDEN", 14, 47);
    UI.bar(ctx, 88, 41, 95, 8, hud.health / 5, { fill: "#ff6b6b", bg: "#3b2034" });
    UI.drawFloats(ctx);
    ctx.fillStyle = "#8da1c2"; ctx.font = "12px monospace";
    ctx.fillText("CLICK THE GLOWING BUDS · SPACE / click after game over to replay", 14, 65);
    if (hud.messageAlpha > 0) { ctx.globalAlpha = hud.messageAlpha; ctx.fillStyle = "#ffe066"; ctx.font = "bold 20px monospace"; ctx.fillText(hud.message, 14, vp.h - 20); ctx.globalAlpha = 1; }
    if (hud.pulse > 0) { ctx.strokeStyle = `rgba(255,224,102,${hud.pulse})`; ctx.lineWidth = 3; ctx.strokeRect(5, 5, vp.w - 10, vp.h - 10); }
    if (state === "gameover") {
      ctx.fillStyle = "rgba(7,10,24,.82)"; ctx.fillRect(0, 0, vp.w, vp.h);
      ctx.textAlign = "center"; ctx.fillStyle = "#ff6b6b"; ctx.font = "bold 34px monospace"; ctx.fillText("GARDEN SILENT", vp.w / 2, vp.h / 2 - 18);
      ctx.fillStyle = "#fff"; ctx.font = "15px monospace"; ctx.fillText(`FINAL SCORE ${hud.score}`, vp.w / 2, vp.h / 2 + 14);
      ctx.fillStyle = "#9fb3d9"; ctx.font = "13px monospace"; ctx.fillText("SPACE or click to grow another run", vp.w / 2, vp.h / 2 + 42); ctx.textAlign = "left";
    }
  },
});
