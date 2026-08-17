import {
  buttonState,
  drawFocusRing,
  focusFromPointer,
  hoverCursor,
  place,
  pointerGestureOwned,
  registerFocusable,
  centeredText,
  uiCtx,
  uiFont,
  uiPointer,
  widgetId,
  type Flowable,
} from "@src/ui/core/index.js";

/** A canvas image drawn into an ordinary UI flow slot. */
export interface ImageOptions extends Flowable {
  /** Stable identity for layout capture and diagnostics. */
  id?: string;
  /** The decoded image source to draw. */
  source: CanvasImageSource;
  /** Crop to fill the slot, or letterbox to fit inside it. Default `cover`. */
  fit?: "cover" | "contain";
}

/** A focusable/clickable image, useful for profile thumbnails and avatars. */
export interface ImageButtonOptions extends Omit<ImageOptions, "source"> {
  /** The decoded image, or omitted for a neutral empty state. */
  source?: CanvasImageSource;
  /** Stable identity enables focus and layout diagnostics. */
  id?: string;
  /** Called when the image is pressed and released on itself. */
  onClick?: () => void;
  /** Drawn over the image while hovered, e.g. a pencil icon. */
  hoverIcon?: string;
  /** Text shown when no source has been accepted yet. */
  placeholder?: string;
}

/** Draw a decoded image as a UI widget. The source is intentionally supplied by
 * the caller: loading, validation and lifecycle belong to the app that owns the
 * asset, while this widget only handles layout and canvas painting. */
export function image(opts: ImageOptions): { x: number; y: number; w: number; h: number } {
  const rect = place(opts, opts.w ?? 64, opts.h ?? 64, "image");
  const source = opts.source as CanvasImageSource & {
    width?: number;
    height?: number;
    naturalWidth?: number;
    naturalHeight?: number;
  };
  const sw = source.naturalWidth ?? source.width ?? 1;
  const sh = source.naturalHeight ?? source.height ?? 1;
  const scale =
    opts.fit === "contain"
      ? Math.min(rect.w / sw, rect.h / sh)
      : Math.max(rect.w / sw, rect.h / sh);
  const dw = sw * scale;
  const dh = sh * scale;
  const ctx = uiCtx();
  ctx.save();
  ctx.beginPath();
  ctx.rect(rect.x, rect.y, rect.w, rect.h);
  ctx.clip();
  ctx.drawImage(source, rect.x + (rect.w - dw) / 2, rect.y + (rect.h - dh) / 2, dw, dh);
  ctx.restore();
  return rect;
}

/** Draw an image as its own button. The image remains visible beneath the
 * hover treatment, so callers do not need to layer an opaque button over it. */
export function imageButton(opts: ImageButtonOptions): boolean {
  const rect = place(opts, opts.w ?? 64, opts.h ?? 64, "image-button");
  const ctx = uiCtx();
  const id = widgetId(opts.id, "image-button");
  const focused = registerFocusable(ctx, { id, rect });
  const pointer = uiPointer();
  const state = buttonState(rect, pointer);
  const clicked = !pointerGestureOwned() && state.clicked;
  if (clicked) {
    focusFromPointer(ctx, id);
    opts.onClick?.();
  }

  ctx.save();
  if (opts.source) {
    const source = opts.source as CanvasImageSource & {
      width?: number;
      height?: number;
      naturalWidth?: number;
      naturalHeight?: number;
    };
    const sw = source.naturalWidth ?? source.width ?? 1;
    const sh = source.naturalHeight ?? source.height ?? 1;
    const scale =
      opts.fit === "contain"
        ? Math.min(rect.w / sw, rect.h / sh)
        : Math.max(rect.w / sw, rect.h / sh);
    const dw = sw * scale;
    const dh = sh * scale;
    ctx.beginPath();
    ctx.rect(rect.x, rect.y, rect.w, rect.h);
    ctx.clip();
    ctx.drawImage(source, rect.x + (rect.w - dw) / 2, rect.y + (rect.h - dh) / 2, dw, dh);
  } else {
    ctx.fillStyle = "#d8dbe6";
    ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
    if (opts.placeholder) {
      ctx.font = uiFont(10);
      ctx.fillStyle = "#18213f";
      ctx.textAlign = "center";
      centeredText(ctx, opts.placeholder, rect.x + rect.w / 2, rect.y + rect.h / 2);
    }
  }
  if (state.hover && opts.hoverIcon) {
    ctx.fillStyle = "rgba(24, 33, 63, 0.58)";
    ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
    ctx.font = uiFont(Math.max(14, Math.min(rect.w, rect.h) * 0.45), true);
    ctx.fillStyle = "#ffffff";
    ctx.textAlign = "center";
    centeredText(ctx, opts.hoverIcon, rect.x + rect.w / 2, rect.y + rect.h / 2);
  }
  ctx.restore();
  hoverCursor(state.hover);
  if (focused) drawFocusRing(ctx, rect);
  return clicked;
}
