// ---------- Game helpers ----------
// Neutral, reusable building blocks: score/best persistence and letterbox
// scaling. Opinionated, pre-styled screens (game-over / level-complete
// overlays) deliberately live in game code, not the engine.

import * as Storage from "./storage.js";

/** Score + best-score tracker with automatic persistence.
 *  `best` is loaded from localStorage and saved whenever score exceeds it. */
export interface ScoreTracker {
  readonly score: number;
  readonly best: number;
  /** Add points; auto-saves best if exceeded */
  add(points: number): void;
  /** Reset the current score to 0 (keeps `best`) — call on restart. */
  reset(): void;
  /** Force-save current best (e.g. on game over) */
  save(): void;
}

export function createScoreTracker(storageKey: string): ScoreTracker {
  let _score = 0;
  let _best = Storage.load(storageKey, 0);
  return {
    get score() {
      return _score;
    },
    get best() {
      return _best;
    },
    add(points: number) {
      _score += points;
      if (_score > _best) {
        _best = _score;
        Storage.save(storageKey, _best);
      }
    },
    reset() {
      _score = 0;
    },
    save() {
      Storage.save(storageKey, _best);
    },
  };
}

/** Letterbox scaling: compute the scale and offset to fit a fixed game
 *  area (gameW × gameH) inside the viewport while maintaining aspect ratio.
 *  Returns { scale, ox, oy }. */
export function letterbox(
  gameW: number,
  gameH: number,
  viewW: number,
  viewH: number,
): { scale: number; ox: number; oy: number } {
  const scale = Math.min(viewW / gameW, viewH / gameH);
  const ox = (viewW - gameW * scale) / 2;
  const oy = (viewH - gameH * scale) / 2;
  return { scale, ox, oy };
}

/** Draw the letterbox background (fills the full canvas, then draws the
 *  game-area background). Call at the start of your draw function. */
export function drawLetterbox(
  ctx: CanvasRenderingContext2D,
  viewW: number,
  viewH: number,
  gameW: number,
  gameH: number,
  bgColor = "#000",
  gameBgColor = "#111",
): { scale: number; ox: number; oy: number } {
  ctx.fillStyle = bgColor;
  ctx.fillRect(0, 0, viewW, viewH);
  const { scale, ox, oy } = letterbox(gameW, gameH, viewW, viewH);
  ctx.fillStyle = gameBgColor;
  ctx.fillRect(ox, oy, gameW * scale, gameH * scale);
  return { scale, ox, oy };
}

/** A letterbox fit plus the coordinate mapping between fixed logical game
 *  coordinates and on-screen pixels. Games that lay out at a fixed resolution
 *  and hit-test the pointer against logical rects need the SCREEN→LOGICAL
 *  inverse, which is the easy-to-get-wrong part (divide, don't just add the
 *  offset). Build once per frame from the live viewport. */
export interface LetterboxView {
  scale: number;
  ox: number;
  oy: number;
  /** Logical point → screen point. */
  point(x: number, y: number): { x: number; y: number };
  /** Logical rect → screen rect. */
  rect(r: { x: number; y: number; w: number; h: number }): {
    x: number;
    y: number;
    w: number;
    h: number;
  };
  /** Screen point → logical point (e.g. the pointer). */
  toLogical(sx: number, sy: number): { x: number; y: number };
  /** Is the screen point inside the logical rect `r`? (pointer hit-test) */
  contains(sx: number, sy: number, r: { x: number; y: number; w: number; h: number }): boolean;
}

export function letterboxView(
  gameW: number,
  gameH: number,
  viewW: number,
  viewH: number,
): LetterboxView {
  const { scale, ox, oy } = letterbox(gameW, gameH, viewW, viewH);
  return {
    scale,
    ox,
    oy,
    point: (x, y) => ({ x: ox + x * scale, y: oy + y * scale }),
    rect: (r) => ({ x: ox + r.x * scale, y: oy + r.y * scale, w: r.w * scale, h: r.h * scale }),
    toLogical: (sx, sy) => ({ x: (sx - ox) / scale, y: (sy - oy) / scale }),
    contains: (sx, sy, r) => {
      const lx = (sx - ox) / scale;
      const ly = (sy - oy) / scale;
      return lx >= r.x && lx <= r.x + r.w && ly >= r.y && ly <= r.y + r.h;
    },
  };
}

/** Format milliseconds as `m:ss` (or `h:mm:ss` past an hour) — the timer/score
 *  screen clock that otherwise gets re-derived, with the seconds always padded. */
export function formatClock(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const ss = s.toString().padStart(2, "0");
  if (h > 0) return `${h}:${m.toString().padStart(2, "0")}:${ss}`;
  return `${m}:${ss}`;
}
