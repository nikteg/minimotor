// ---------- Parallax scroll iterator ----------

/** Iterate evenly-spaced columns for a scrolling/parallax background.
 *
 *  `scroll` is how far the layer has moved (e.g. `distance * parallaxFactor`),
 *  `spacing` the gap between columns, `width` the viewport width. For each
 *  visible column `cb` receives:
 *   - `screenX`  — where to draw it (already wrapped),
 *   - `worldSeed`— a value tied to the world column, *stable* across scroll
 *     wraps, so procedural shapes (building heights, peaks) don't shimmer when
 *     the offset resets,
 *   - `index`    — the integer world-column index.
 *
 *  `pad` extends iteration by N columns past each edge for wide props.
 *  Works for negative scroll too. */
export function scrollColumns(
  scroll: number,
  spacing: number,
  width: number,
  cb: (screenX: number, worldSeed: number, index: number) => void,
  pad = 1,
): void {
  const offset = ((scroll % spacing) + spacing) % spacing;
  const colBase = Math.floor(scroll / spacing) * spacing;
  for (let bx = -spacing * pad; bx < width + spacing * pad; bx += spacing) {
    cb(bx - offset, bx + colBase, Math.round((bx + colBase) / spacing));
  }
}
