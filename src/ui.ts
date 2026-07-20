// ---------- UI ----------
// Immediate-mode interface helpers: floating combat/score text, buttons and
// meter bars. Everything draws with plain ctx calls in YOUR draw phase — no
// retained widget tree, no layout engine. Floating texts age on the fixed
// step (via Loop.onStep), so they pause with the loop like Clock/Tween.
//
//   Minimotor.UI.float("+100", x, y, { color: "#ffd43b" }); // spawn (update)
//   Minimotor.UI.drawFloats(ctx);                           // draw, on top
//   if (Minimotor.UI.button(ctx, { x, y, w: 160, h: 44, label: "PLAY" })) start();
//   Minimotor.UI.bar(ctx, 10, 10, 120, 10, hp / maxHp);

import { Loop, Pointer } from "./engine.js";
import { pointInRect } from "./collision.js";

// ---------- Floating text ----------

/** Options for a floating text. */
export interface FloatOptions {
  /** Rise speed in px/s (negative = up). Default -50. */
  vy?: number;
  /** Lifetime in ms. Default 900. */
  life?: number;
  /** Fill color. Default "#fff". */
  color?: string;
  /** Font. Default "bold 14px monospace". */
  font?: string;
}

interface FloatText {
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
export interface FloatManager {
  spawn(text: string, x: number, y: number, opts?: FloatOptions): void;
  /** Age every text by `dt` ms; expired ones are removed. */
  advance(dt: number): void;
  /** Draw all live texts, centered on their (drifting) position. */
  draw(ctx: CanvasRenderingContext2D): void;
  clear(): void;
  readonly size: number;
}

export function createFloats(): FloatManager {
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

// ---------- Button ----------

/** Style knobs for `button()`. Every color has a readable default. */
export interface ButtonStyle {
  font?: string;
  /** Label color. */
  color?: string;
  /** Fill when idle / hovered / held down. */
  bg?: string;
  bgHover?: string;
  bgActive?: string;
}

/** A button's geometry + label. */
export interface ButtonOptions extends ButtonStyle {
  x: number;
  y: number;
  w: number;
  h: number;
  label: string;
}

/** The interaction state `button()` derives from a pointer. Pure — exported
 *  for tests and for custom-drawn buttons that want the logic without the
 *  default look. */
export function buttonState(
  rect: { x: number; y: number; w: number; h: number },
  pointer: { x: number; y: number; down: boolean; released: boolean },
): { hover: boolean; active: boolean; clicked: boolean } {
  const hover = pointInRect(pointer.x, pointer.y, rect);
  return { hover, active: hover && pointer.down, clicked: hover && pointer.released };
}

/** Draw an immediate-mode button and report whether it was clicked this
 *  frame. Call it every frame from `draw` — there is no retained widget:
 *
 *    if (UI.button(ctx, { x, y, w: 160, h: 44, label: "PLAY" })) start();
 *
 *  Hit-testing uses the polled `Pointer` in canvas coordinates — draw the
 *  button untransformed (outside camera/letterbox transforms). */
export function button(ctx: CanvasRenderingContext2D, opts: ButtonOptions): boolean {
  // frameReleased, not released: the per-step edge is consumed by the fixed
  // steps before draw runs; the frame-scoped one is held for us until then.
  const { hover, active, clicked } = buttonState(opts, {
    x: Pointer.x,
    y: Pointer.y,
    down: Pointer.down,
    released: Pointer.frameReleased,
  });

  ctx.save();
  ctx.fillStyle = active
    ? (opts.bgActive ?? "#1d2b36")
    : hover
      ? (opts.bgHover ?? "#2c4356")
      : (opts.bg ?? "#24384a");
  ctx.fillRect(opts.x, opts.y, opts.w, opts.h);
  ctx.strokeStyle = hover ? "#4ecdc4" : "#3a5568";
  ctx.lineWidth = 2;
  ctx.strokeRect(opts.x + 1, opts.y + 1, opts.w - 2, opts.h - 2);
  ctx.fillStyle = opts.color ?? "#e8f0f4";
  ctx.font = opts.font ?? "bold 15px monospace";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(opts.label, opts.x + opts.w / 2, opts.y + opts.h / 2 + (active ? 1 : 0));
  ctx.restore();

  return clicked;
}

// ---------- Bar ----------

/** Style knobs for `bar()`. */
export interface BarStyle {
  /** Track color behind the fill. */
  bg?: string;
  /** Fill color. */
  fill?: string;
}

/** A horizontal meter (health, progress, charge): a track with `frac` (0..1,
 *  clamped) of it filled from the left. */
export function bar(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  frac: number,
  style: BarStyle = {},
): void {
  const f = Math.max(0, Math.min(1, frac));
  ctx.save();
  ctx.fillStyle = style.bg ?? "rgba(255,255,255,0.15)";
  ctx.fillRect(x, y, w, h);
  if (f > 0) {
    ctx.fillStyle = style.fill ?? "#4ecdc4";
    ctx.fillRect(x, y, w * f, h);
  }
  ctx.restore();
}

// ---------- Default facade (floats aged by the default Loop's fixed step) ----------

let floats = createFloats();
let wired = false;

function ensureWired(): void {
  if (wired) return;
  wired = true;
  Loop.onStep(() => floats.advance(Loop.step));
}

/** Spawn a rising, fading text at (x, y) — score pops, damage numbers,
 *  pickup labels. Aged on the fixed step; draw with `drawFloats`. */
export function float(text: string, x: number, y: number, opts?: FloatOptions): void {
  ensureWired();
  floats.spawn(text, x, y, opts);
}

/** Draw all live floating texts. Call late in `draw` so they sit on top. */
export function drawFloats(ctx: CanvasRenderingContext2D): void {
  floats.draw(ctx);
}

/** Remove all floating texts (e.g. on scene change). */
export function clearFloats(): void {
  floats.clear();
}

/** Reset floats and Loop wiring — for tests. */
export function _reset(): void {
  floats = createFloats();
  wired = false;
}
