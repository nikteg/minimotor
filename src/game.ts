// ---------- Game helpers ----------
// Neutral, reusable building blocks: score/best persistence and clock
// formatting. Opinionated, pre-styled screens (game-over / level-complete
// overlays) deliberately live in game code, not the engine.
//
// Fitting a fixed logical area into the viewport is NOT here: `App.init({
// resolution })` does the fit, the bars, the pointer mapping and the base
// transform in one place. The hand-rolled `letterbox`/`drawLetterbox`/
// `letterboxView` trio that used to live here was a weaker duplicate of it.

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

/** Make a `ScoreTracker` persisting `best` under `storageKey` in localStorage
 *  (loaded now, re-saved whenever the score passes it). */
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
