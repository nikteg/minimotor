// ASSET QUEST: a tiny playable archive loaded from a manifest at runtime.
// Focus: Assets.load/progress/json/image and Anim.sheet, with plain JSON level data.
import { Minimotor } from "minimotor";
import * as Sfx from "../../shared/src/sfx.js";

let vp = Minimotor.Stage.init("game", { plugins: [Minimotor.Perf.plugin()] });
Minimotor.Stage.onResize((next) => (vp = next));
const { Assets, Anim, Text, Keys, Loop, Particles, UI } = Minimotor;
let progress = 0, ready = false, level, hero, seal, relics = [], score = 0, state = "play", elapsed = 0;
const player = { x: 96, y: 128, speed: 145 };
const gate = { x: 12 * 48 + 24, y: 48 + 24 };

// Build a deliberately clean 8-frame astronaut sheet. The loaded PNG is an
// archive seal, not a sprite sheet; slicing arbitrary artwork was the source
// of the old "spinning icon" bug.
function makeHeroSheet() {
  const sheet = document.createElement("canvas");
  sheet.width = 48 * 8;
  sheet.height = 48;
  const c = sheet.getContext("2d");
  for (let i = 0; i < 8; i++) {
    const x = i * 48 + 24;
    const step = Math.sin((i / 8) * Math.PI * 2) * 3;
    c.save();
    c.translate(x, 24);
    c.fillStyle = "#172b4d";
    c.beginPath(); c.ellipse(0, 7, 11, 13, 0, 0, Math.PI * 2); c.fill();
    c.strokeStyle = "#64f0c8"; c.lineWidth = 2; c.stroke();
    c.fillStyle = "#b8fff0"; c.beginPath(); c.arc(0, -7, 9, 0, Math.PI * 2); c.fill();
    c.fillStyle = "#234b69"; c.fillRect(-6, -9, 12, 5);
    c.fillStyle = "#ff9f43"; c.fillRect(-8, 18 + step, 6, 4); c.fillRect(2, 18 - step, 6, 4);
    c.strokeStyle = "#ffe066"; c.beginPath(); c.moveTo(0, -16); c.lineTo(0, -21); c.stroke();
    c.fillStyle = "#ffe066"; c.beginPath(); c.arc(0, -22, 2, 0, Math.PI * 2); c.fill();
    c.restore();
  }
  return sheet;
}

// JSON and image are loaded in parallel; the loading screen itself uses no DOM UI.
Assets.load({ level: new URL("../level.json", import.meta.url).href, icon: new URL("../icon.png", import.meta.url).href }, (done, total) => { progress = done / total; })
  .then(() => {
    level = Assets.json("level");
    seal = Assets.image("icon");
    hero = Anim.sheet(makeHeroSheet(), { fw: 48, fh: 48, fps: 10 });
    relics = level.tiles.flatMap((row, y) => row.map((tile, x) => tile === 2 ? { x: x * 48 + 24, y: y * 48 + 24, got: false } : null).filter(Boolean));
    resetGame();
    ready = true;
  })
  .catch((err) => { level = { message: String(err) }; });

function solid(x, y) {
  const tx = Math.floor(x / 48), ty = Math.floor(y / 48);
  const tile = level?.tiles?.[ty]?.[tx];
  return tile == null || tile === 1;
}
function circleClear(x, y, radius = 15) {
  const points = [[-radius, 0], [radius, 0], [0, -radius], [0, radius], [-radius * .7, -radius * .7], [radius * .7, -radius * .7], [-radius * .7, radius * .7], [radius * .7, radius * .7]];
  return points.every(([px, py]) => !solid(x + px, y + py));
}
function move(dx, dy) {
  const nx = player.x + dx, ny = player.y + dy;
  // Resolve axes independently: walls block cleanly while allowing sliding.
  if (circleClear(nx, player.y)) player.x = nx;
  if (circleClear(player.x, ny)) player.y = ny;
}
function resetGame() {
  player.x = 96; player.y = 128; score = 0; elapsed = 0; state = "play";
  for (const relic of relics) relic.got = false;
}

Loop.run({
  update(stepMs) {
    if (!ready) return;
    hero.update(stepMs);
    if (Keys.pressed("KeyR")) resetGame();
    if (state !== "play") return;
    const dt = stepMs / 1000;
    elapsed += dt;
    if (Keys.down("ArrowLeft") || Keys.down("KeyA")) move(-player.speed * dt, 0);
    if (Keys.down("ArrowRight") || Keys.down("KeyD")) move(player.speed * dt, 0);
    if (Keys.down("ArrowUp") || Keys.down("KeyW")) move(0, -player.speed * dt);
    if (Keys.down("ArrowDown") || Keys.down("KeyS")) move(0, player.speed * dt);
    for (const r of relics) if (!r.got && Math.hypot(player.x - r.x, player.y - r.y) < 24) {
      r.got = true; score++; Sfx.pickup(); UI.float("+1 KEY", r.x, r.y - 22, { color: "#ffe066" });
      Particles.burst(r.x, r.y, { count: 18, colors: ["#ffe066", "#fff"], speed: [30, 150], life: [300, 650], gravity: 80 });
    }
    if (score === relics.length && Math.hypot(player.x - gate.x, player.y - gate.y) < 28) {
      state = "won"; Sfx.win();
      Particles.burst(gate.x, gate.y, { count: 45, colors: ["#64f0c8", "#ffe066", "#fff"], speed: [40, 220], life: [500, 1200], gravity: 60 });
    }
  },
  draw(ctx) {
    ctx.fillStyle = "#111827"; ctx.fillRect(0, 0, vp.w, vp.h);
    if (!ready) {
      Text.drawCentered(ctx, "LOADING MOONLIT ARCHIVE", vp.w / 2, vp.h / 2 - 24, { font: "bold 24px monospace", color: "#ffe066" });
      UI.panel(ctx, { x: vp.w / 2 - 170, y: vp.h / 2 + 4, w: 340, h: 34, bg: "#172640", border: "#38557e" });
      UI.bar(ctx, vp.w / 2 - 150, vp.h / 2 + 15, 300, 12, progress, { fill: "#4ecdc4", bg: "#263653" });
      return;
    }
    const ox = Math.max(12, (vp.w - 14 * 48) / 2), oy = Math.max(60, (vp.h - 7 * 48) / 2);
    for (let y = 0; y < level.tiles.length; y++) for (let x = 0; x < level.tiles[y].length; x++) {
      const tile = level.tiles[y][x]; ctx.fillStyle = tile === 1 ? "#263653" : "#16233b"; ctx.fillRect(ox + x * 48, oy + y * 48, 47, 47);
      if (tile === 1) { ctx.fillStyle = "#354b72"; ctx.fillRect(ox + x * 48 + 5, oy + y * 48 + 5, 37, 5); }
    }
    // World is intentionally translated so the JSON map is centered responsively.
    ctx.save(); ctx.translate(ox, oy);
    const gateOpen = score === relics.length;
    ctx.fillStyle = gateOpen ? "#64f0c8" : "#405477";
    ctx.fillRect(gate.x - 15, gate.y - 20, 30, 40);
    ctx.fillStyle = gateOpen ? "#d9fff6" : "#182942";
    ctx.fillRect(gate.x - 9, gate.y - 14, 18, 28);
    for (const r of relics) if (!r.got) {
      const pulse = 10 + Math.sin(performance.now() / 180 + r.x) * 2;
      ctx.fillStyle = "#ffe066"; ctx.beginPath(); ctx.arc(r.x, r.y, pulse, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "#fff8"; ctx.beginPath(); ctx.arc(r.x - 3, r.y - 3, 3, 0, Math.PI * 2); ctx.fill();
    }
    hero.draw(ctx, player.x, player.y, { w: 46, h: 46 });
    // Pickup/gate bursts live in world coordinates, so render them under the
    // same map offset as the player instead of at raw screen coordinates.
    UI.drawFloats(ctx);
    Particles.draw(ctx);
    ctx.restore();
    UI.panel(ctx, { x: 8, y: 7, w: 350, h: 38, bg: "rgba(8,14,27,.85)", border: "#38557e" });
    Text.drawText(ctx, `MOON KEYS ${score}/${relics.length}   TIME ${elapsed.toFixed(1)}s`, 14, 14, { font: "bold 16px monospace", color: "#fff" });
    Text.drawText(ctx, "WASD / ARROWS: MOVE · R: RESTART", 14, 36, { font: "12px monospace", color: "#9fb3d9" });
    if (seal) { ctx.globalAlpha = 0.75; ctx.drawImage(seal, vp.w - 48, 10, 32, 32); ctx.globalAlpha = 1; }
    Text.drawText(ctx, gateOpen ? "All keys found — reach the glowing archive gate" : level.message, 14, vp.h - 26, { font: "13px monospace", color: gateOpen ? "#64f0c8" : "#9fb3d9" });
    if (state === "won") {
      ctx.fillStyle = "rgba(8,14,27,.82)"; ctx.fillRect(0, 0, vp.w, vp.h);
      Text.drawCentered(ctx, "ARCHIVE RESTORED", vp.w / 2, vp.h / 2 - 24, { font: "bold 30px monospace", color: "#64f0c8" });
      Text.drawCentered(ctx, `Run time ${elapsed.toFixed(1)}s`, vp.w / 2, vp.h / 2 + 10, { font: "16px monospace", color: "#fff" });
      Text.drawCentered(ctx, "Press R to explore again", vp.w / 2, vp.h / 2 + 42, { font: "13px monospace", color: "#9fb3d9" });
    }
  },
});
