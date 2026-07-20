// DUNGEON SCOUT: grid, flood-fill and line-of-sight recipes in a tiny roguelike.
import { Minimotor } from "minimotor";
const { Goodies, Input, Loop, UI, Pointer } = Minimotor;
let vp = Minimotor.Stage.init("game", { plugins: [Minimotor.Perf.plugin()] });
Minimotor.Stage.onResize((next) => (vp = next));
const actions = Input.actions({ up: ["ArrowUp", "KeyW"], down: ["ArrowDown", "KeyS"], left: ["ArrowLeft", "KeyA"], right: ["ArrowRight", "KeyD"] });
const COLS = 20, ROWS = 12, CELL = 28;
let map, hero, exit, reachable, visible;

function generate() {
  map = Array.from({ length: ROWS }, (_r, y) => Array.from({ length: COLS }, (_c, x) => x === 0 || y === 0 || x === COLS - 1 || y === ROWS - 1 || Goodies.chance(0.2) ? 1 : 0));
  hero = { x: 1, y: 1 }; exit = { x: COLS - 2, y: ROWS - 2 };
  map[hero.y][hero.x] = 0; map[exit.y][exit.x] = 0;
  const carved = [...Goodies.gridLine(hero.x, hero.y, exit.x, hero.y), ...Goodies.gridLine(exit.x, hero.y, exit.x, exit.y)];
  for (const p of carved) map[p.y][p.x] = 0;
  recalc();
}
function recalc() {
  const cells = Goodies.floodFill(hero, (x, y) => map[y]?.[x] === 0);
  reachable = new Set(cells.map((p) => `${p.x},${p.y}`));
  visible = new Set();
  for (let y = 0; y < ROWS; y++) for (let x = 0; x < COLS; x++) {
    if (Math.hypot(x - hero.x, y - hero.y) <= 6 && Goodies.lineOfSight(hero.x, hero.y, x, y, (cx, cy) => map[cy]?.[cx] === 1, false)) visible.add(`${x},${y}`);
  }
}
function tryMove(dx, dy) { const x = hero.x + dx, y = hero.y + dy; if (map[y]?.[x] === 0) { hero = { x, y }; recalc(); } }
generate();

Loop.run({ update() {
  if (actions.pressed("up")) tryMove(0, -1); else if (actions.pressed("down")) tryMove(0, 1); else if (actions.pressed("left")) tryMove(-1, 0); else if (actions.pressed("right")) tryMove(1, 0);
  if (Minimotor.Keys.pressed("KeyR")) generate();
}, draw(ctx) {
  ctx.fillStyle = "#0d1118"; ctx.fillRect(0, 0, vp.w, vp.h);
  const ox = Math.round((vp.w - COLS * CELL) / 2), oy = 86;
  // A titled `group` owns the header: the title strip and the body text below
  // are laid out with the theme's padding — no hand-tuned y under the strip.
  // `h: body.remaining` fills the padded body so the line centers in it.
  UI.group({ x: ox - 12, y: 12, w: COLS * CELL + 24, h: 60, title: "DUNGEON SCOUT" }, (body) => {
    UI.text(`Reachable ${reachable.size} · arrows/WASD move · R rebuild`, { h: body.remaining, size: 11, color: "dim" });
  });
  for (let y = 0; y < ROWS; y++) for (let x = 0; x < COLS; x++) {
    const seen = visible.has(`${x},${y}`), wall = map[y][x] === 1;
    ctx.fillStyle = !seen ? "#080b10" : wall ? "#394558" : reachable.has(`${x},${y}`) ? "#1d3940" : "#18202b";
    ctx.fillRect(ox + x * CELL + 1, oy + y * CELL + 1, CELL - 2, CELL - 2);
  }
  ctx.fillStyle = "#ffe066"; ctx.fillRect(ox + exit.x * CELL + 8, oy + exit.y * CELL + 8, 12, 12);
  ctx.fillStyle = "#4ecdc4"; ctx.beginPath(); ctx.arc(ox + hero.x * CELL + CELL / 2, oy + hero.y * CELL + CELL / 2, 8, 0, Math.PI * 2); ctx.fill();
  const gx = Math.floor((Pointer.x - ox) / CELL), gy = Math.floor((Pointer.y - oy) / CELL);
  if (gx >= 0 && gy >= 0 && gx < COLS && gy < ROWS) {
    const line = Goodies.gridLine(hero.x, hero.y, gx, gy);
    ctx.fillStyle = "rgba(255,224,102,.35)";
    for (const p of line) ctx.fillRect(ox + p.x * CELL + 10, oy + p.y * CELL + 10, 8, 8);
  }
} });
