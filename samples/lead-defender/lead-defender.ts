import { createPerformanceMonitoring } from "minimotor/performance";
// LEAD DEFENDER: predictive aiming, angle steering, wave scaling and radial spawns.
import { createParticles } from "minimotor/particles";
import { createUI } from "minimotor/ui";
import { Collision, Goodies, createApp } from "minimotor";

interface Enemy {
  x: number;
  y: number;
  vx: number;
  vy: number;
  hp: number;
  speed: number;
}
interface Bullet {
  x: number;
  y: number;
  vx: number;
  vy: number;
  ttl: number;
}

// Live viewport; the engine owns the background clear.
const game = createApp("game", {
  background: "#080d18",
  preventNavigation: true,
});
createPerformanceMonitoring(game);
const vp = game.viewport;
const { Draw, Keys, Loop } = game;
const Particles = createParticles(game);
const UI = createUI(game);
// Per-step constants (the fixed step is the time unit — 60 steps/s).
const BULLET_SPEED = 5; // px/step (was 300 px/s)
const TURRET_TURN = 5 / 60; // rad/step (was 5 rad/s)
const FIRE_COOLDOWN = 11; // steps (was 0.18 s)
const fx = Particles.createSystem();
let enemies: Enemy[] = [],
  bullets: Bullet[] = [],
  wave = 0,
  lives = 10,
  score = 0,
  cooldown = 0,
  turret = -Math.PI / 2;
function nextWave() {
  wave++;
  const scale = Goodies.waveScale(wave, {
    count: 4,
    countPerWave: 2,
    healthGrowth: 1.22,
    speedGrowth: 1.05,
  });
  const cx = vp.w / 2,
    cy = vp.h / 2;
  enemies = Goodies.ringFormation(
    scale.count,
    cx,
    cy,
    Math.max(vp.w, vp.h) * 0.56,
    wave * 0.37,
  ).map((p) => ({
    x: p.x,
    y: p.y,
    vx: 0,
    vy: 0,
    hp: Math.ceil(scale.health),
    speed: 0.4 * scale.speed,
  }));
}
nextWave();
Loop.run({
  update() {
    const cx = vp.w / 2,
      cy = vp.h / 2;
    cooldown -= 1;
    for (const e of enemies) {
      const a = Math.atan2(cy - e.y, cx - e.x);
      e.vx = Math.cos(a) * e.speed;
      e.vy = Math.sin(a) * e.speed;
      e.x += e.vx;
      e.y += e.vy;
    }
    enemies = enemies.filter((e) => {
      if (Collision.circleHit(e.x, e.y, 0, cx, cy, 25)) {
        lives--;
        fx.burst({ at: { x: cx, y: cy }, count: 12, color: ["#ff6b6b", "#fff"] });
        return false;
      }
      return true;
    });
    const target = Goodies.nearest(cx, cy, enemies, (e) => e);
    if (target) {
      const lead = Goodies.leadTarget(
        cx,
        cy,
        target.x,
        target.y,
        target.vx,
        target.vy,
        BULLET_SPEED,
      );
      if (lead) {
        const wanted = Math.atan2(lead.y - cy, lead.x - cx);
        turret = Goodies.approachAngle(turret, wanted, TURRET_TURN);
        if (cooldown <= 0 && Math.abs(Goodies.wrappedDelta(turret, wanted, Math.PI * 2)) < 0.08) {
          bullets.push({
            x: cx,
            y: cy,
            vx: Math.cos(turret) * BULLET_SPEED,
            vy: Math.sin(turret) * BULLET_SPEED,
            ttl: 120,
          });
          cooldown = FIRE_COOLDOWN;
        }
      }
    }
    for (const b of bullets) {
      b.x += b.vx;
      b.y += b.vy;
      b.ttl -= 1;
    }
    for (let bi = bullets.length - 1; bi >= 0; bi--)
      for (let ei = enemies.length - 1; ei >= 0; ei--) {
        if (
          Collision.circleHit(bullets[bi].x, bullets[bi].y, 0, enemies[ei].x, enemies[ei].y, 12)
        ) {
          const hit = Goodies.damageRoll(1, { variance: 0, critChance: 0.12, critMultiplier: 2 });
          enemies[ei].hp -= hit.amount;
          fx.burst({
            at: bullets[bi],
            count: hit.critical ? 12 : 5,
            color: hit.critical ? ["#ffe066", "#fff"] : "#4ecdc4",
            life: [120, 300],
          });
          bullets.splice(bi, 1);
          if (enemies[ei].hp <= 0) {
            enemies.splice(ei, 1);
            score += hit.critical ? 20 : 10;
          }
          break;
        }
      }
    bullets = bullets.filter((b) => b.ttl > 0);
    if (!enemies.length) nextWave();
    if (lives <= 0 || Keys.pressed("KeyR")) {
      wave = 0;
      lives = 10;
      score = 0;
      bullets = [];
      nextWave();
    }
  },
  draw(ctx) {
    const cx = vp.w / 2,
      cy = vp.h / 2;
    // Range rings and the rotated turret are stroked/transformed paths — raw ctx.
    ctx.strokeStyle = "#18314f";
    for (let r = 80; r < Math.max(vp.w, vp.h); r += 80) {
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.stroke();
    }
    for (const e of enemies) Draw.circle(e, 9, "#ff6b6b");
    for (const b of bullets) Draw.circle(b, 3, "#ffe066");
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(turret);
    ctx.fillStyle = "#4ecdc4";
    ctx.fillRect(-12, -8, 24, 16);
    ctx.fillRect(0, -3, 32, 6);
    ctx.restore();
    Draw.particles(fx);
    UI.panel({ x: 10, y: 10, w: 280, h: 60, title: "LEAD DEFENDER" }, (body) => {
      UI.text(
        `Wave ${wave}   Core ${lives}   Score ${score}   Rank ${Goodies.scoreRank(score, [0, 100, 300, 700], ["C", "B", "A", "S"])}`,
        { h: body.remaining, size: 11 },
      );
    });
  },
});
