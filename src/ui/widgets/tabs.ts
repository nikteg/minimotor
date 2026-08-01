// ---------- tabs ----------
import {
  Flowable,
  buttonState,
  centeredText,
  consumeKeyboardCommand,
  drawBox,
  drawFocusRing,
  focusFromPointer,
  hoverCursor,
  measureWidth,
  place,
  registerFocusable,
  roundRectPath,
  theme,
  uiCtx,
  uiFont,
  uiPointer,
  widgetId,
} from "@src/ui/core/index.js";

/** A horizontal tab strip. */
export interface TabsOptions extends Flowable {
  /** Stable identity enables Tab focus and arrow-key selection. */
  id?: string;
  /** Position in the keyboard tab order. */
  tabIndex?: number;
  /** Total width, split equally between the tabs. Omit to auto-size every
   *  cell to the widest label. */
  w?: number;
  /** Strip height in px. Default `theme.tabH`. */
  h?: number;
  /** Tab labels, left to right. */
  items: string[];
  /** Current tab index — pass your state in, assign the return value back. */
  active: number;
  /** Label font. Default a bold `theme.fontSize` UI font. */
  font?: string;
}

/** Draw a tab strip; returns the (possibly changed) active index:
 *
 *    tab = UI.tabs({ x, y, items: ["All", "Coop", "PvP"], active: tab }); */
export function tabs(opts: TabsOptions): number {
  const ctx = uiCtx();
  ctx.save();
  ctx.font = opts.font ?? uiFont(theme.fontSize, true);
  // Auto width: equal cells sized to the widest label.
  const w =
    opts.w ??
    (Math.ceil(Math.max(...opts.items.map((t) => measureWidth(ctx, t)))) +
      theme.spacing.lg * 2 +
      2) *
      opts.items.length;
  const rect = place(opts, w, opts.h ?? theme.tabH, "tabs", true);
  const id = widgetId(opts.id, "tabs");
  const keyboardFocused = registerFocusable(ctx, { id, tabIndex: opts.tabIndex, rect });
  const cellW = rect.w / opts.items.length;
  const p = uiPointer();
  let active = opts.active;
  const command = consumeKeyboardCommand(id);
  if (command === "ArrowRight" || command === "ArrowDown")
    active = (active + 1) % opts.items.length;
  if (command === "ArrowLeft" || command === "ArrowUp")
    active = (active - 1 + opts.items.length) % opts.items.length;
  ctx.textAlign = "center";
  // Uniform baseline across the row: `centeredText` centers each label's own
  // ink box, so labels with descenders (g/q) would sit higher than others.
  // "middle" is font-relative (string-independent), so every tab lines up.
  ctx.textBaseline = "middle";
  // Round only the strip's outer corners: clip the whole strip, fill cells
  // square inside it.
  ctx.save();
  roundRectPath(ctx, rect.x, rect.y, rect.w, rect.h, theme.radius);
  ctx.clip();
  opts.items.forEach((label, i) => {
    const x = rect.x + i * cellW;
    const { hover, clicked } = buttonState({ x, y: rect.y, w: cellW, h: rect.h }, p);
    hoverCursor(hover);
    if (clicked) {
      active = i;
      focusFromPointer(ctx, id);
    }
    const isActive = i === active;
    const hasTabSkin = !!(
      theme.skin?.frames.tab ||
      theme.skin?.frames.tabHover ||
      theme.skin?.frames.tabActive
    );
    if (hasTabSkin) {
      drawBox(ctx, x, rect.y, cellW - 2, rect.h, {
        fill: isActive ? theme.bg : hover ? theme.bgHover : theme.bgActive,
        stroke: theme.border,
        role: "tab",
        state: isActive ? "active" : hover ? "hover" : "default",
        // The tab band runs along x. A frame the pack authored vertically
        // (`orientation: "y"`) is rotated into it, which is how a plate whose
        // open edge is on one END becomes a tab whose open edge is its BOTTOM.
        axis: "x",
      });
    } else {
      ctx.fillStyle = isActive ? theme.bg : hover ? theme.bgHover : theme.bgActive;
      ctx.fillRect(x, rect.y, cellW - 2, rect.h);
      if (isActive) {
        ctx.fillStyle = theme.accent;
        ctx.fillRect(x, rect.y + rect.h - (theme.spacing.sm - 1), cellW - 2, theme.spacing.sm - 1);
      }
    }
    ctx.fillStyle = isActive ? theme.text : theme.textDim;
    ctx.textAlign = "center";
    centeredText(ctx, label, x + cellW / 2, rect.y + rect.h / 2, cellW - (theme.spacing.lg - 2));
  });
  ctx.restore();
  ctx.restore();
  if (keyboardFocused) drawFocusRing(ctx, rect);
  return active;
}
