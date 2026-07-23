// ---------- Floating text ----------
// Rising, fading score pops / damage numbers / pickup labels. The default pool
// ages on the kernel's fixed step (registered via onStep), so it pauses with the
// loop; make your own pool with createFloatText and drive advance(dt) yourself.
import { ensureWired, onReset, onStep, uiCtx } from "../core/index.js";
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

export interface FloatText {
  text: string;
  x: number;
  y: number;
  vy: number;
  life: number;
  remaining: number;
  color: string;
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

// The shared default pool, aged on the fixed step (via onStep) so it pauses with
// the loop like Clock/Tween.
export let floats = createFloatText();

let hooksRegistered = false;
function ensureFloatTextHooks(): void {
  if (hooksRegistered) return;
  hooksRegistered = true;
  onStep(() => floats.advance(Loop.step));
  onReset(() => {
    floats = createFloatText();
  });
}

/** Spawn a rising, fading text at (x, y) — score pops, damage numbers,
 *  pickup labels. Aged on the fixed step; draw with `drawFloatText`. */
export function floatText(str: string, x: number, y: number, opts?: FloatTextOptions): void {
  ensureWired();
  ensureFloatTextHooks();
  floats.spawn(str, x, y, opts);
}

/** Draw all live floating texts. Call late in `draw` so they sit on top. */
export function drawFloatText(ctx?: CanvasRenderingContext2D): void {
  floats.draw(ctx ?? uiCtx());
}

/** Remove all floating texts (e.g. on scene change). */
export function clearFloatText(): void {
  floats.clear();
}
