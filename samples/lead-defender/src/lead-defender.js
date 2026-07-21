// LEAD DEFENDER: predictive aiming, angle steering, wave scaling and radial spawns.
import { Minimotor } from "minimotor";
const { Goodies, Collision, Loop, UI, Particles } = Minimotor;
let vp = Minimotor.Stage.init("game", { plugins: [Minimotor.Perf.plugin()] });
Minimotor.Stage.onResize((next) => (vp = next));
let enemies = [], bullets = [], wave = 0, lives = 10, score = 0, cooldown = 0, turret = -Math.PI / 2;
function nextWave() {
  wave++; const scale = Goodies.waveScale(wave, { count: 4, countPerWave: 2, healthGrowth: 1.22, speedGrowth: 1.05 });
  const cx = vp.w / 2, cy = vp.h / 2;
  enemies = Goodies.ringFormation(scale.count, cx, cy, Math.max(vp.w, vp.h) * 0.56, wave * 0.37).map((p) => ({ x: p.x, y: p.y, vx: 0, vy: 0, hp: Math.ceil(scale.health), speed: 24 * scale.speed }));
}
nextWave();
Loop.run({ update(stepMs) {
  const dt = stepMs / 1000, cx = vp.w / 2, cy = vp.h / 2;
  cooldown -= dt;
  for (const e of enemies) { const a = Math.atan2(cy - e.y, cx - e.x); e.vx = Math.cos(a) * e.speed; e.vy = Math.sin(a) * e.speed; e.x += e.vx * dt; e.y += e.vy * dt; }
  enemies = enemies.filter((e) => { if (Collision.circleHit(e.x, e.y, 0, cx, cy, 25)) { lives--; Particles.burst(cx, cy, { count: 12, colors: ["#ff6b6b", "#fff"] }); return false; } return true; });
  const target = Goodies.nearest(cx, cy, enemies, (e) => e);
  if (target) {
    const lead = Goodies.leadTarget(cx, cy, target.x, target.y, target.vx, target.vy, 300);
    if (lead) {
      const wanted = Math.atan2(lead.y - cy, lead.x - cx);
      turret = Goodies.approachAngle(turret, wanted, dt * 5);
      if (cooldown <= 0 && Math.abs(Goodies.wrappedDelta(turret, wanted, Math.PI * 2)) < 0.08) { bullets.push({ x: cx, y: cy, vx: Math.cos(turret) * 300, vy: Math.sin(turret) * 300, ttl: 2 }); cooldown = 0.18; }
    }
  }
  for (const b of bullets) { b.x += b.vx * dt; b.y += b.vy * dt; b.ttl -= dt; }
  for (let bi = bullets.length - 1; bi >= 0; bi--) for (let ei = enemies.length - 1; ei >= 0; ei--) {
    if (Collision.circleHit(bullets[bi].x, bullets[bi].y, 0, enemies[ei].x, enemies[ei].y, 12)) {
      const hit = Goodies.damageRoll(1, { variance: 0, critChance: 0.12, critMultiplier: 2 }); enemies[ei].hp -= hit.amount;
      Particles.burst(bullets[bi].x, bullets[bi].y, { count: hit.critical ? 12 : 5, colors: hit.critical ? ["#ffe066", "#fff"] : "#4ecdc4", life: [120, 300] });
      bullets.splice(bi, 1); if (enemies[ei].hp <= 0) { enemies.splice(ei, 1); score += hit.critical ? 20 : 10; } break;
    }
  }
  bullets = bullets.filter((b) => b.ttl > 0);
  if (!enemies.length) nextWave();
  if (lives <= 0 || Minimotor.Keys.pressed("KeyR")) { wave = 0; lives = 10; score = 0; bullets = []; nextWave(); }
}, draw(ctx) {
  ctx.fillStyle = "#080d18"; ctx.fillRect(0, 0, vp.w, vp.h); const cx = vp.w / 2, cy = vp.h / 2;
  ctx.strokeStyle = "#18314f"; for (let r = 80; r < Math.max(vp.w, vp.h); r += 80) { ctx.beginPath(); ctx.arc(cx, cy, r, 0, Math.PI * 2); ctx.stroke(); }
  for (const e of enemies) { ctx.fillStyle = "#ff6b6b"; ctx.beginPath(); ctx.arc(e.x, e.y, 9, 0, Math.PI * 2); ctx.fill(); }
  ctx.fillStyle = "#ffe066"; for (const b of bullets) { ctx.beginPath(); ctx.arc(b.x, b.y, 3, 0, Math.PI * 2); ctx.fill(); }
  ctx.save(); ctx.translate(cx, cy); ctx.rotate(turret); ctx.fillStyle = "#4ecdc4"; ctx.fillRect(-12, -8, 24, 16); ctx.fillRect(0, -3, 32, 6); ctx.restore();
  Particles.draw(ctx);
  UI.group({ x: 10, y: 10, w: 280, h: 60, title: "LEAD DEFENDER" }, (body) => {
    UI.text(`Wave ${wave}   Core ${lives}   Score ${score}   Rank ${Goodies.scoreRank(score, [0,100,300,700], ["C","B","A","S"])}`, { h: body.remaining, size: 11 });
  });
} });
