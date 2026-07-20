// BEAT CIRCUIT: racing checkpoints scored against a rhythm timing window.
import { Minimotor } from "minimotor";
const { Goodies, Input, Loop, UI, Mathf } = Minimotor;
let vp = Minimotor.Stage.init("game", { plugins: [Minimotor.Perf.plugin()] });
Minimotor.Stage.onResize((next) => (vp = next));
const actions = Input.actions({ left: ["ArrowLeft", "KeyA"], right: ["ArrowRight", "KeyD"], gas: ["ArrowUp", "KeyW"], brake: ["ArrowDown", "KeyS"] });
const route = Goodies.checkpointRoute(4), BEAT = 700;
let car = { x: 0, y: 0, angle: 0, speed: 0 }, elapsed = 0, score = 0, lastGrade = "HIT THE GATES ON BEAT", gateLock = -1;
function gates() { const cx = vp.w / 2, cy = vp.h / 2; return [{x:cx+220,y:cy},{x:cx,y:cy+140},{x:cx-220,y:cy},{x:cx,y:cy-140}]; }
function reset() { const g = gates(); car = { x: g[3].x, y: g[3].y, angle: 0, speed: 0 }; elapsed = 0; score = 0; route.reset(); gateLock = -1; }
reset();
Loop.run({ update(stepMs) {
  const dt = stepMs / 1000; elapsed += stepMs;
  const steer = (actions.down("right") ? 1 : 0) - (actions.down("left") ? 1 : 0);
  if (actions.down("gas")) car.speed += 150 * dt; else car.speed *= Math.pow(0.985, stepMs / 16.67);
  if (actions.down("brake")) car.speed -= 180 * dt;
  car.speed = Mathf.clamp(car.speed, -55, 190); car.angle += steer * dt * 2.4 * (car.speed >= 0 ? 1 : -1);
  car.x = Goodies.wrap(car.x + Math.cos(car.angle) * car.speed * dt, vp.w);
  car.y = Goodies.wrap(car.y + Math.sin(car.angle) * car.speed * dt, vp.h);
  const gs = gates(); let touching = -1;
  for (let i = 0; i < gs.length; i++) if (Math.hypot(car.x - gs[i].x, car.y - gs[i].y) < 30) touching = i;
  if (touching !== gateLock && touching === route.next && route.visit(touching)) {
    const offset = ((elapsed + BEAT / 2) % BEAT) - BEAT / 2;
    const grade = Goodies.timingGrade(offset); lastGrade = grade.toUpperCase();
    score += { perfect: 400, great: 250, good: 100, miss: 25 }[grade];
    Minimotor.Audio.Sfx.blip(grade === "perfect" ? 880 : 520, 0.08);
  }
  gateLock = touching;
  if (Minimotor.Keys.pressed("KeyR")) reset();
}, draw(ctx) {
  const cycle = Goodies.dayCycle(elapsed, 20_000); const bg = { dawn:"#382840", day:"#18314f", dusk:"#40233c", night:"#10101b" }[cycle.phase];
  ctx.fillStyle = bg; ctx.fillRect(0, 0, vp.w, vp.h); const cx = vp.w / 2, cy = vp.h / 2;
  ctx.strokeStyle = "#596778"; ctx.lineWidth = 46; ctx.beginPath(); ctx.ellipse(cx, cy, 220, 140, 0, 0, Math.PI*2); ctx.stroke();
  ctx.strokeStyle = "#202b38"; ctx.lineWidth = 32; ctx.stroke();
  gates().forEach((g,i) => { ctx.strokeStyle = i === route.next ? "#ffe066" : "#4ecdc4"; ctx.lineWidth = 5; ctx.beginPath(); ctx.arc(g.x,g.y,24,0,Math.PI*2); ctx.stroke(); UI.text(ctx, String(i+1), {x:g.x-8,y:g.y-10,w:16,h:20,align:"center"}); });
  const pulse = 1 - Math.abs(((elapsed % BEAT) / BEAT) * 2 - 1); ctx.strokeStyle = `rgba(255,224,102,${0.2+pulse*0.7})`; ctx.lineWidth = 4; ctx.beginPath(); ctx.arc(cx,cy,30+pulse*45,0,Math.PI*2); ctx.stroke();
  ctx.save(); ctx.translate(car.x,car.y); ctx.rotate(car.angle); ctx.fillStyle="#ff6b6b"; ctx.fillRect(-13,-7,26,14); ctx.fillStyle="#fff"; ctx.fillRect(4,-4,6,8); ctx.restore();
  UI.group({x:10,y:10,w:310,h:60,title:"BEAT CIRCUIT"}, (body) => UI.text(`Lap ${route.lap}  Score ${score}  ${lastGrade}  ${cycle.phase.toUpperCase()}`,{h:body.remaining,size:11}));
  UI.text(ctx,"Arrows/WASD drive · R restart",{x:12,y:vp.h-28,size:11,color:"dim"});
} });
