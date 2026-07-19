// ---------- Game helpers ----------
// Neutral, reusable building blocks: score/best persistence and letterbox
// scaling. Opinionated, pre-styled screens (game-over / level-complete
// overlays) deliberately live in game code, not the engine.

import * as Storage from "./storage.js";

/** Score + best-score tracker with automatic persistence.
 *  `best` is loaded from localStorage and saved whenever score exceeds it. */
export interface ScoreTracker {
  score: number;
  readonly best: number;
  /** Add points; auto-saves best if exceeded */
  add(points: number): void;
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
