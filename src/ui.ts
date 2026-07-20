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
  /** Grayed out and unclickable. */
  disabled?: boolean;
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
  const state = opts.disabled
    ? { hover: false, active: false, clicked: false }
    : buttonState(opts, {
        x: Pointer.x,
        y: Pointer.y,
        down: Pointer.down,
        released: Pointer.frameReleased,
      });
  const { hover, active, clicked } = state;

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
  ctx.fillStyle = opts.disabled ? "#5a6a75" : (opts.color ?? "#e8f0f4");
  ctx.font = opts.font ?? "bold 15px monospace";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(opts.label, opts.x + opts.w / 2, opts.y + opts.h / 2 + (active ? 1 : 0));
  ctx.restore();

  return clicked;
}

// ---------- Panel ----------

/** A framed box with an optional title strip — visual grouping for menus,
 *  dialogs and HUD clusters. Purely decorative; it captures no input. */
export interface PanelOptions {
  x: number;
  y: number;
  w: number;
  h: number;
  title?: string;
  bg?: string;
  border?: string;
  titleColor?: string;
  font?: string;
}

export function panel(ctx: CanvasRenderingContext2D, opts: PanelOptions): void {
  ctx.save();
  ctx.fillStyle = opts.bg ?? "rgba(13,18,26,0.92)";
  ctx.fillRect(opts.x, opts.y, opts.w, opts.h);
  ctx.strokeStyle = opts.border ?? "#3a5568";
  ctx.lineWidth = 2;
  ctx.strokeRect(opts.x + 1, opts.y + 1, opts.w - 2, opts.h - 2);
  if (opts.title) {
    ctx.fillStyle = "rgba(255,255,255,0.06)";
    ctx.fillRect(opts.x + 2, opts.y + 2, opts.w - 4, 30);
    ctx.fillStyle = opts.titleColor ?? "#4ecdc4";
    ctx.font = opts.font ?? "bold 14px monospace";
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillText(opts.title, opts.x + 12, opts.y + 17);
  }
  ctx.restore();
}

// ---------- Toggle ----------

/** A labeled checkbox. */
export interface ToggleOptions {
  x: number;
  y: number;
  label: string;
  /** Current value — pass your state in, assign the return value back. */
  on: boolean;
  size?: number;
  font?: string;
  color?: string;
}

/** Draw a checkbox + label; returns the (possibly flipped) new value:
 *
 *    hideFull = UI.toggle(ctx, { x, y, label: "Hide full", on: hideFull }); */
export function toggle(ctx: CanvasRenderingContext2D, opts: ToggleOptions): boolean {
  const size = opts.size ?? 16;
  const font = opts.font ?? "13px monospace";
  ctx.save();
  ctx.font = font;
  const labelW = ctx.measureText(opts.label).width;
  // Hit region spans box + label, so the text is clickable too.
  const rect = { x: opts.x, y: opts.y, w: size + 8 + labelW, h: size };
  const { hover, clicked } = buttonState(rect, {
    x: Pointer.x,
    y: Pointer.y,
    down: Pointer.down,
    released: Pointer.frameReleased,
  });
  const on = clicked ? !opts.on : opts.on;

  ctx.fillStyle = "#1d2b36";
  ctx.fillRect(opts.x, opts.y, size, size);
  ctx.strokeStyle = hover ? "#4ecdc4" : "#3a5568";
  ctx.lineWidth = 2;
  ctx.strokeRect(opts.x + 1, opts.y + 1, size - 2, size - 2);
  if (on) {
    ctx.fillStyle = "#4ecdc4";
    ctx.fillRect(opts.x + 4, opts.y + 4, size - 8, size - 8);
  }
  ctx.fillStyle = opts.color ?? "#c6d4dc";
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillText(opts.label, opts.x + size + 8, opts.y + size / 2 + 1);
  ctx.restore();
  return on;
}

// ---------- Tabs ----------

/** A horizontal tab strip. */
export interface TabsOptions {
  x: number;
  y: number;
  /** Total width, split equally between the tabs. */
  w: number;
  h?: number;
  items: string[];
  /** Current tab index — pass your state in, assign the return value back. */
  active: number;
  font?: string;
}

/** Draw a tab strip; returns the (possibly changed) active index:
 *
 *    tab = UI.tabs(ctx, { x, y, w: 320, items: ["All", "Coop", "PvP"], active: tab }); */
export function tabs(ctx: CanvasRenderingContext2D, opts: TabsOptions): number {
  const h = opts.h ?? 30;
  const cellW = opts.w / opts.items.length;
  let active = opts.active;
  ctx.save();
  ctx.font = opts.font ?? "bold 13px monospace";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  opts.items.forEach((label, i) => {
    const x = opts.x + i * cellW;
    const { hover, clicked } = buttonState(
      { x, y: opts.y, w: cellW, h },
      { x: Pointer.x, y: Pointer.y, down: Pointer.down, released: Pointer.frameReleased },
    );
    if (clicked) active = i;
    const isActive = i === active;
    ctx.fillStyle = isActive ? "#24384a" : hover ? "#1a2732" : "#141d26";
    ctx.fillRect(x, opts.y, cellW - 2, h);
    if (isActive) {
      ctx.fillStyle = "#4ecdc4";
      ctx.fillRect(x, opts.y + h - 3, cellW - 2, 3);
    }
    ctx.fillStyle = isActive ? "#e8f0f4" : "#7d8894";
    ctx.fillText(label, x + cellW / 2, opts.y + h / 2 + 1);
  });
  ctx.restore();
  return active;
}

// ---------- Row ----------

/** A selectable list row. */
export interface RowOptions {
  x: number;
  y: number;
  w: number;
  h: number;
  selected?: boolean;
  bg?: string;
  bgHover?: string;
  bgSelected?: string;
}

/** Draw a row background with hover/selected states and report a click.
 *  Draw your own content (columns, icons) on top afterwards:
 *
 *    if (UI.row(ctx, { x, y, w, h, selected: i === sel })) sel = i; */
export function row(ctx: CanvasRenderingContext2D, opts: RowOptions): boolean {
  const { hover, clicked } = buttonState(opts, {
    x: Pointer.x,
    y: Pointer.y,
    down: Pointer.down,
    released: Pointer.frameReleased,
  });
  ctx.save();
  ctx.fillStyle = opts.selected
    ? (opts.bgSelected ?? "rgba(78,205,196,0.18)")
    : hover
      ? (opts.bgHover ?? "rgba(255,255,255,0.05)")
      : (opts.bg ?? "transparent");
  if (ctx.fillStyle !== "transparent") ctx.fillRect(opts.x, opts.y, opts.w, opts.h);
  if (opts.selected) {
    ctx.fillStyle = "#4ecdc4";
    ctx.fillRect(opts.x, opts.y, 3, opts.h);
  }
  ctx.restore();
  return clicked;
}

// ---------- Scrollbar ----------

/** A vertical scrollbar bound to a content/view extent. */
export interface ScrollbarOptions {
  /** Track position + height (the bar is vertical). */
  x: number;
  y: number;
  h: number;
  /** Track width. Default 10. */
  w?: number;
  /** Visible extent, in content px. */
  view: number;
  /** Total content extent, in content px. */
  content: number;
  /** Current scroll offset — pass your state in, assign the return back. */
  offset: number;
  /** Rect that reacts to the mouse wheel (usually the list area). */
  wheelArea?: { x: number; y: number; w: number; h: number };
  /** Identity for drag tracking across frames. Defaults to the track
   *  position — pass an explicit id if the bar moves while dragged. */
  id?: string;
  track?: string;
  thumb?: string;
}

// One drag at a time, tracked across frames by the scrollbar's id.
let scrollDrag: { id: string; grab: number } | null = null;

/** Compute the next offset for a scrollbar — thumb drag, track paging and
 *  wheel — and draw it. Returns the new offset (clamped to the content):
 *
 *    scroll = UI.scrollbar(ctx, { x, y, h, view, content, offset: scroll, wheelArea }); */
export function scrollbar(ctx: CanvasRenderingContext2D, opts: ScrollbarOptions): number {
  const max = Math.max(0, opts.content - opts.view);
  let offset = Math.max(0, Math.min(max, opts.offset));
  if (max <= 0) return 0; // everything fits — draw nothing

  const id = opts.id ?? `${opts.x}:${opts.y}`;
  const w = opts.w ?? 10;
  const thumbH = Math.max(24, (opts.view / opts.content) * opts.h);
  const range = opts.h - thumbH;
  let thumbY = opts.y + (offset / max) * range;

  const overThumb = pointInRect(Pointer.x, Pointer.y, { x: opts.x, y: thumbY, w, h: thumbH });
  const overTrack = pointInRect(Pointer.x, Pointer.y, { x: opts.x, y: opts.y, w, h: opts.h });

  if (!Pointer.down) scrollDrag = null;
  if (Pointer.framePressed && overThumb && !scrollDrag) {
    scrollDrag = { id, grab: Pointer.y - thumbY };
  } else if (Pointer.frameReleased && overTrack && !overThumb && scrollDrag?.id !== id) {
    // Track click: page toward the click.
    offset += Pointer.y < thumbY ? -opts.view : opts.view;
  }
  if (scrollDrag?.id === id && range > 0) {
    offset = ((Pointer.y - scrollDrag.grab - opts.y) / range) * max;
  }
  if (opts.wheelArea && pointInRect(Pointer.x, Pointer.y, opts.wheelArea)) {
    offset += Pointer.wheel;
  }

  offset = Math.max(0, Math.min(max, offset));
  thumbY = opts.y + (offset / max) * range;

  ctx.save();
  ctx.fillStyle = opts.track ?? "rgba(255,255,255,0.07)";
  ctx.fillRect(opts.x, opts.y, w, opts.h);
  ctx.fillStyle =
    scrollDrag?.id === id ? "#4ecdc4" : overThumb ? "#6adfd7" : (opts.thumb ?? "#3a5568");
  ctx.fillRect(opts.x + 1, thumbY, w - 2, thumbH);
  ctx.restore();
  return offset;
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
