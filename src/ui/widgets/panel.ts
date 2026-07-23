// ---------- panel ----------
import {
  centeredText,
  drawBox,
  roundRectPath,
  theme,
  uiCtx,
  uiFont,
  withCtx,
  runContainer,
  anchorViewport,
  ANCHOR_H,
  ANCHOR_V,
  type TextAnchor,
} from "../core/index.js";

/** A framed box with an optional title strip — visual grouping for menus,
 *  dialogs and HUD clusters. Purely decorative; it captures no input. */
export interface PanelOptions {
  /** Left edge in px. */
  x: number;
  /** Top edge in px. */
  y: number;
  /** Width in px. */
  w: number;
  /** Height in px. */
  h: number;
  /** Optional title; when set, a title strip is drawn along the top. */
  title?: string;
  /** Fill color. Default `theme.panelBg`. */
  bg?: string;
  /** Border color. Default `theme.border`. */
  border?: string;
  /** Title text color. Default `theme.accent`. */
  titleColor?: string;
  /** Title font. Default a bold `theme.fontSize + 1` UI font. */
  font?: string;
}

/** Options for the container form of `panel` — a panel that LAYS OUT its
 *  children (a column with gap/pad), anchored to the screen or positioned
 *  absolutely. Auto-height panels measure their children and remember the
 *  height per `id` (one-frame lag on first appearance — standard IM). */
export interface PanelContainerOptions {
  /** Named screen anchor (center for menus). x/y become offsets from it. */
  anchor?: TextAnchor;
  x?: number;
  y?: number;
  /** Panel width. Default 260. */
  w?: number;
  /** Panel height. Omit to size to the children (measured, 1-frame lag). */
  h?: number;
  /** Inner padding. Default 16. */
  pad?: number;
  /** Gap between children. Default 10. */
  gap?: number;
  /** Identity for the height memo (defaults to anchor+size). */
  id?: string;
  title?: string;
  bg?: string;
  border?: string;
}

const panelHeights = new Map<string, number>();

function panelContainer<R>(opts: PanelContainerOptions, children: () => R): R {
  const ctx = uiCtx();
  const w = opts.w ?? 260;
  const pad = opts.pad ?? 16;
  const key = opts.id ?? `panel:${opts.anchor ?? "abs"}:${w}`;
  const h = opts.h ?? panelHeights.get(key) ?? 64;
  let x = opts.x ?? 0;
  let y = opts.y ?? 0;
  if (opts.anchor) {
    const view = anchorViewport(ctx);
    const hx = ANCHOR_H[opts.anchor];
    const vy = ANCHOR_V[opts.anchor];
    const baseX = hx === 0 ? view.safeLeft : hx === 0.5 ? view.w / 2 : view.w;
    const baseY = vy === 0 ? view.safeTop : vy === 0.5 ? view.h / 2 : view.h;
    x = baseX - hx * w + (opts.x ?? 0);
    y = baseY - vy * h + (opts.y ?? 0);
  }
  panel(ctx, { x, y, w, h, title: opts.title, bg: opts.bg, border: opts.border });
  const top = opts.title ? 32 : 0;
  let measured = h;
  const out = runContainer(
    "col",
    { x, y: y + top, w, h: h - top },
    opts.gap ?? 10,
    pad,
    "start",
    (st) => {
      const r = children();
      const ext = st.extent;
      measured = ext.y + ext.h - y + pad;
      return r;
    },
  );
  if (opts.h === undefined) panelHeights.set(key, measured);
  return out;
}

/** Draw a framed box (value form, `PanelOptions`) or — when passed a
 *  `children` callback — a self-laying-out panel (`PanelContainerOptions`) that
 *  flows children down a padded column and can `anchor` to the screen. Optional
 *  `title` strip; captures no input either way. */
export function panel(opts: PanelOptions): void;
export function panel(ctx: CanvasRenderingContext2D, opts: PanelOptions): void;
export function panel<R>(opts: PanelContainerOptions, children: () => R): R;
export function panel<R>(
  a: CanvasRenderingContext2D | PanelOptions | PanelContainerOptions,
  b?: PanelOptions | (() => R),
): R | void {
  // Container form: `UI.panel({ anchor: "center", w: 260 }, () => {...})`.
  if (typeof b === "function") return panelContainer(a as PanelContainerOptions, b);
  const [ctx, opts] = withCtx(a as CanvasRenderingContext2D | PanelOptions, b as PanelOptions);
  ctx.save();
  drawBox(ctx, opts.x, opts.y, opts.w, opts.h, {
    fill: opts.bg ?? theme.panelBg,
    stroke: opts.border ?? theme.border,
  });
  if (opts.title) {
    // Title strip clipped to the panel's rounded top so it doesn't poke past
    // the corners.
    ctx.save();
    roundRectPath(ctx, opts.x, opts.y, opts.w, opts.h, theme.radius);
    ctx.clip();
    ctx.fillStyle = "rgba(255,255,255,0.06)";
    ctx.fillRect(opts.x + 2, opts.y + 2, opts.w - 4, 30);
    ctx.restore();
    ctx.fillStyle = opts.titleColor ?? theme.accent;
    ctx.font = opts.font ?? uiFont(theme.fontSize + 1, true);
    ctx.textAlign = "left";
    // Inset the title by the same theme.pad as a group's body, so a titled
    // group's header text and its content line up on the same left edge.
    centeredText(ctx, opts.title, opts.x + theme.pad, opts.y + 17, opts.w - theme.pad * 2);
  }
  ctx.restore();
}
