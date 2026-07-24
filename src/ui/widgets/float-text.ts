// ---------- Floating text ----------
// Rising, fading score pops / damage numbers / pickup labels. The default pool
// ages on the kernel's fixed step (registered via onStep), so it pauses with the
// loop; make your own pool with createFloatText and drive advance(dt) yourself.
import {
  ensureWired,
  lastWidgetRect,
  onReset,
  onStep,
  runtimeSlot,
  uiCtx,
  uiToScreen,
} from "../core/index.js";
import { Loop } from "../../engine/index.js";

/** Options for a floating text. */
export interface FloatTextOptions {
  /** Rise speed in px/s (negative = up). Default -50. */
  vy?: number;
  /** Lifetime in ms. Default 900. */
  life?: number;
  /** Fill color. Default "#fff". */
  color?: string;
  /** Font. Default "bold 14px monospace". */
  font?: string;
}

/** One live floating text in a pool — the record `spawn` creates and
 *  `advance`/`draw` consume. */
export interface FloatText {
  /** The string drawn. */
  text: string;
  /** Center x in px (the text is drawn centered on its position). */
  x: number;
  /** Center y in px — drifts by `vy` as the text ages. */
  y: number;
  /** Vertical drift in px/s (negative = up). */
  vy: number;
  /** Total lifetime in ms; the text fades out over its last half. */
  life: number;
  /** Time left in ms; the text is removed when it reaches 0. */
  remaining: number;
  /** Fill color. */
  color: string;
  /** Canvas font string. */
  font: string;
}

/** A pool of rising, fading texts. Pure — drive `advance(dt)` yourself (the
 *  `UI` facade wires it to the fixed step for you). */
export interface FloatTextManager {
  /** Spawn a rising text at `(x, y)`; `opts` tunes drift/lifetime/color/font. */
  spawn(text: string, x: number, y: number, opts?: FloatTextOptions): void;
  /** Age every text by `dt` ms; expired ones are removed. */
  advance(dt: number): void;
  /** Draw all live texts, centered on their (drifting) position. */
  draw(ctx: CanvasRenderingContext2D): void;
  /** Remove every text at once. */
  clear(): void;
  /** Number of live texts currently in the pool. */
  readonly size: number;
}

/** Create a fresh, empty `FloatTextManager` pool. The `UI` facade keeps a
 *  shared one (`UI.floatText`); make your own for an isolated set of texts. */
export function createFloatText(): FloatTextManager {
  const texts: FloatText[] = [];
  return {
    spawn(text, x, y, opts = {}) {
      texts.push({
        text,
        x,
        y,
        vy: opts.vy ?? -50,
        life: opts.life ?? 900,
        remaining: opts.life ?? 900,
        color: opts.color ?? "#fff",
        font: opts.font ?? "bold 14px monospace",
      });
    },

    advance(dt) {
      for (let i = texts.length - 1; i >= 0; i--) {
        const t = texts[i];
        t.remaining -= dt;
        if (t.remaining <= 0) {
          texts.splice(i, 1);
          continue;
        }
        t.y += (t.vy * dt) / 1000;
      }
    },

    draw(ctx) {
      if (texts.length === 0) return;
      ctx.save();
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      for (const t of texts) {
        // Full strength, then fade out over the last half of the lifetime.
        ctx.globalAlpha = Math.min(1, (2 * t.remaining) / t.life);
        ctx.fillStyle = t.color;
        ctx.font = t.font;
        ctx.fillText(t.text, t.x, t.y);
      }
      ctx.restore();
    },

    clear() {
      texts.length = 0;
    },

    get size() {
      return texts.length;
    },
  };
}

// The per-runtime default pool behind `floatText`/`drawFloatText`, aged on the
// fixed step (via `onStep`) so it pauses with the loop like Clock/Tween.
const floats = runtimeSlot<FloatTextManager>(createFloatText);

let hooksRegistered = false;
function ensureFloatTextHooks(): void {
  if (hooksRegistered) return;
  hooksRegistered = true;
  onStep(() => floats().advance(Loop.step));
  onReset(() => {
    floats().clear();
  });
}

/** Spawn a rising, fading text at (x, y) — score pops, damage numbers,
 *  pickup labels. Aged on the fixed step; draw with `drawFloatText`. Coords are
 *  taken in the CURRENT space: spawn inside a `UI.scaled` block and the point is
 *  mapped to screen for you, so it still lands right when `drawFloatText` paints
 *  it later (after the transform is gone).
 *
 *  Omit `x`/`y` to ANCHOR: the text rises from the top-center of the last
 *  placed widget, so a flowing button needs no coordinates:
 *
 *    if (UI.button("Collect")) UI.floatText("+10");   // pops above the button */
export function floatText(str: string, opts?: FloatTextOptions): void;
export function floatText(str: string, x: number, y: number, opts?: FloatTextOptions): void;
export function floatText(
  str: string,
  xOrOpts?: number | FloatTextOptions,
  y?: number,
  opts?: FloatTextOptions,
): void {
  ensureWired();
  ensureFloatTextHooks();
  let px: number, py: number;
  if (typeof xOrOpts === "number") {
    px = xOrOpts;
    py = y ?? 0;
  } else {
    opts = xOrOpts;
    const anchor = lastWidgetRect();
    px = anchor ? anchor.x + anchor.w / 2 : 0;
    py = anchor ? anchor.y - 4 : 0;
  }
  const p = uiToScreen(px, py);
  floats().spawn(str, p.x, p.y, opts);
}

/** Draw all live floating texts. Call late in `draw` so they sit on top. */
export function drawFloatText(): void {
  floats().draw(uiCtx());
}

/** Remove all floating texts (e.g. on scene change). */
export function clearFloatText(): void {
  floats().clear();
}
