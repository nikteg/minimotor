import { createPerformanceMonitoring } from "minimotor/performance";
// DUNGEON SCOUT: grid recipes in a tiny roguelike — a SEEDED layout (seedRng),
// a distance-from-hero heatmap (distanceField), plus line-of-sight fog.
import { createInput } from "minimotor/input";
import { createUI } from "minimotor/ui";
import { Gizmos, Goodies, Mathf, App } from "minimotor";

const game = App.create("game", {
  background: "#0d1118",
  preventNavigation: true,
});
createPerformanceMonitoring(game);
const view = game.viewport;
const { Draw, Keys, Loop, Pointer } = game;
const Input = createInput(game);
const UI = createUI(game, Input);
const input = Input.map({
  up: ["ArrowUp", "KeyW"],
  down: ["ArrowDown", "KeyS"],
  left: ["ArrowLeft", "KeyA"],
  right: ["ArrowRight", "KeyD"],
});
const COLS = 20,
  ROWS = 12,
  CELL = 28;
interface Cell {
  x: number;
  y: number;
}
let map: number[][];
let hero: Cell, exit: Cell;
let reachable: Set<string>, visible: Set<string>;
let field: Goodies.DistanceField;
let maxDist: number;
let seed = 1; // R advances the seed; the same seed always rebuilds the same map

function generate() {
  // seedRng makes the layout reproducible — same seed, same dungeon.
  const rng = Gizmos.seedRng(seed);
  map = Array.from({ length: ROWS }, (_r, y) =>
    Array.from({ length: COLS }, (_c, x) =>
      x === 0 || y === 0 || x === COLS - 1 || y === ROWS - 1 || Goodies.chance(0.2, rng) ? 1 : 0,
    ),
  );
  hero = { x: 1, y: 1 };
  exit = { x: COLS - 2, y: ROWS - 2 };
  map[hero.y][hero.x] = 0;
  map[exit.y][exit.x] = 0;
  const carved = [
    ...Goodies.gridLine(hero.x, hero.y, exit.x, hero.y),
    ...Goodies.gridLine(exit.x, hero.y, exit.x, exit.y),
  ];
  for (const p of carved) map[p.y][p.x] = 0;
  recalc();
}
function recalc() {
  // distanceField: BFS step-distance from the hero to every open cell. The
  // reachable set falls out of `field.cells`; `at()` drives the heatmap.
  field = Goodies.distanceField(hero, (x, y) => map[y]?.[x] === 0);
  reachable = new Set(field.cells.map((c) => `${c.x},${c.y}`));
  maxDist = field.cells.reduce((m, c) => Math.max(m, c.dist), 1);
  visible = new Set();
  for (let y = 0; y < ROWS; y++)
    for (let x = 0; x < COLS; x++) {
      if (
        Math.hypot(x - hero.x, y - hero.y) <= 6 &&
        Goodies.lineOfSight(hero.x, hero.y, x, y, (cx, cy) => map[cy]?.[cx] === 1, false)
      )
        visible.add(`${x},${y}`);
    }
}
// Cell color by hero distance: bright teal near, deep blue far.
const mix = (a: number, b: number, t: number) => Math.round(Mathf.lerp(a, b, t));
const heat = (d: number) => {
  const t = Math.min(1, d / maxDist);
  return `rgb(${mix(78, 20, t)},${mix(205, 34, t)},${mix(196, 58, t)})`;
};
function tryMove(dx: number, dy: number) {
  const x = hero.x + dx,
    y = hero.y + dy;
  if (map[y]?.[x] === 0) {
    hero = { x, y };
    recalc();
  }
}
generate();

Loop.run({
  update() {
    if (input.up.pressed) tryMove(0, -1);
    else if (input.down.pressed) tryMove(0, 1);
    else if (input.left.pressed) tryMove(-1, 0);
    else if (input.right.pressed) tryMove(1, 0);
    if (Keys.pressed("KeyR")) {
      seed = (seed + 1) >>> 0;
      generate();
    }
  },
  draw() {
    const ox = Math.round((view.w - COLS * CELL) / 2),
      oy = 86;
    // A titled `group` owns the header: the title strip and the body text below
    // are laid out with the theme's padding — no hand-tuned y under the strip.
    // `h: body.remaining` fills the padded body so the line centers in it.
    UI.panel({ x: ox - 12, y: 12, w: COLS * CELL + 24, h: 60, title: "DUNGEON SCOUT" }, (body) => {
      UI.text(`Reachable ${reachable.size} · seed ${seed} · WASD move · R new seed`, {
        h: body.remaining,
        size: 11,
        color: "dim",
      });
    });
    for (let y = 0; y < ROWS; y++)
      for (let x = 0; x < COLS; x++) {
        const key = `${x},${y}`,
          seen = visible.has(key),
          wall = map[y][x] === 1;
        const color = !seen
          ? "#080b10"
          : wall
            ? "#394558"
            : reachable.has(key)
              ? heat(field.at(x, y))
              : "#18202b";
        Draw.rect(ox + x * CELL + 1, oy + y * CELL + 1, CELL - 2, CELL - 2, color);
      }
    Draw.rect(ox + exit.x * CELL + 8, oy + exit.y * CELL + 8, 12, 12, "#ffe066");
    Draw.circle(ox + hero.x * CELL + CELL / 2, oy + hero.y * CELL + CELL / 2, 8, "#4ecdc4");
    const gx = Math.floor((Pointer.x - ox) / CELL),
      gy = Math.floor((Pointer.y - oy) / CELL);
    if (gx >= 0 && gy >= 0 && gx < COLS && gy < ROWS) {
      const line = Goodies.gridLine(hero.x, hero.y, gx, gy);
      for (const p of line)
        Draw.rect(ox + p.x * CELL + 10, oy + p.y * CELL + 10, 8, 8, "rgba(255,224,102,.35)");
    }
  },
});
