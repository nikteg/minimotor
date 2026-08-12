// ---------- Scratch canvases for bakes ----------
// Sprite atlases, tile-layer bakes, particle dots, font alpha maps, and
// tileset recolors are "make a bitmap" operations with no DOM involvement.
// `OffscreenCanvas` keeps them out of the document (no layout/style cost) and
// is what a worker can construct. Fall back to an HTML canvas when
// OffscreenCanvas is missing or cannot rasterise — jsdom, older browsers.

export type ScratchCanvas = HTMLCanvasElement | OffscreenCanvas;

/** A w×h bitmap surface. Prefers `OffscreenCanvas`; falls back to a detached
 *  HTML canvas when that constructor is missing or `getContext("2d")` fails. */
export function scratchCanvas(w: number, h: number): ScratchCanvas {
  const width = Math.max(1, Math.ceil(w));
  const height = Math.max(1, Math.ceil(h));
  if (typeof OffscreenCanvas === "function") {
    try {
      const c = new OffscreenCanvas(width, height);
      if (c.getContext("2d")) return c;
    } catch {
      // Node without a 2D backend, or a constructor that throws.
    }
  }
  const c = document.createElement("canvas");
  c.width = width;
  c.height = height;
  return c;
}

/** 2D context of a scratch surface, or `null` when the environment cannot
 *  rasterise (jsdom). Callers treat null as "skip the bake". */
export function scratchContext(c: ScratchCanvas): CanvasRenderingContext2D | null {
  return c.getContext("2d") as CanvasRenderingContext2D | null;
}
