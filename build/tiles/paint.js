// ---------- Painting a level ----------
// Everything that turns a `Level` plus a `Skin` into pixels: the reused
// selector view, the dual-grid corner lattice, the per-tile pass, and the
// offscreen bake for static layers.
//
// It is built lazily on first render and handed the finished `Level`, which is
// why this can live outside `grid()` at all — the paint path only ever reads
// the level through its public queries.
import { blitPixelAligned, fillPixelAligned } from "../engine/pixel-raster.js";
import { scratchCanvas, scratchContext } from "../engine/offscreen.js";
import { blitCell, isDualLayer } from "./cells.js";
import { EMPTY, isEmptyChar } from "./glyphs.js";
/** Build the paint path for one level. `cells` is the level's live cell array,
 *  so `set()` is visible here without any notification. */
export function createPainter(dims, cells, level) {
    const { cols, rows, size } = dims;
    // One reused selector-view per level; render rebinds cx/cy/char per cell.
    const selectorCell = {
        cx: 0,
        cy: 0,
        char: EMPTY,
        neighbor(dx, dy) {
            return level.at(this.cx + dx, this.cy + dy) === this.char;
        },
        solid(dx, dy) {
            return level.solidAt((this.cx + dx + 0.5) * size, (this.cy + dy + 0.5) * size);
        },
    };
    const stampPool = [];
    /** Does the cell at (cx, cy) belong to this dual layer's terrain? */
    function dualFilled(cx, cy, char, connect) {
        if (connect === "solid") {
            if (cx < 0 || cy < 0 || cx >= cols || cy >= rows)
                return false;
            return level.solidAt((cx + 0.5) * size, (cy + 0.5) * size);
        }
        return level.at(cx, cy) === char;
    }
    /** Paint one dual-grid layer over [x0..x1]×[y0..y1]. Its lattice is offset by
     *  half a cell, so it walks one extra column and row: the tile at corner
     *  (cx, cy) covers the bottom-right quadrant of cell (cx-1, cy-1) through the
     *  top-left quadrant of cell (cx, cy). Terrain therefore overhangs the level
     *  rect by half a cell on every side and is clipped there — the same in the
     *  live path and the bake. */
    function paintDual(ctx, layer, char, x0, y0, x1, y1) {
        const half = size / 2;
        const connect = layer.connect;
        for (let cy = y0; cy <= y1 + 1; cy++) {
            for (let cx = x0; cx <= x1 + 1; cx++) {
                const mask = (dualFilled(cx - 1, cy - 1, char, connect) ? 1 : 0) |
                    (dualFilled(cx, cy - 1, char, connect) ? 2 : 0) |
                    (dualFilled(cx, cy, char, connect) ? 4 : 0) |
                    (dualFilled(cx - 1, cy, char, connect) ? 8 : 0);
                const cell = layer.dual(mask);
                if (!cell)
                    continue;
                blitCell(ctx, cell, cx * size - half, cy * size - half, size, size);
            }
        }
    }
    /** Paint cells [x0..x1]×[y0..y1] with `s` into `ctx` — shared by the live
     *  per-tile path and the offscreen bake. */
    function paintCells(ctx, s, x0, y0, x1, y1) {
        const prevSmoothing = ctx.imageSmoothingEnabled;
        ctx.imageSmoothingEnabled = false;
        // Flat-color skins repaint the same few colors across thousands of cells;
        // setting fillStyle is a real state change, so only write it when it
        // actually differs. Starts null because the caller's ctx state is unknown.
        let lastFill = null;
        let stampCount = 0;
        try {
            // Dual layers are terrain: they run first, as whole-layer passes over the
            // corner lattice, so ordinary tiles and markers paint on top of them.
            for (const char in s) {
                const value = s[char];
                if (value && typeof value === "object" && isDualLayer(value)) {
                    paintDual(ctx, value, char, x0, y0, x1, y1);
                }
            }
            for (let cy = y0; cy <= y1; cy++) {
                for (let cx = x0; cx <= x1; cx++) {
                    const ch = cells[cy][cx];
                    if (isEmptyChar(ch))
                        continue;
                    let value = s[ch];
                    if (value === null || value === undefined)
                        continue;
                    if (typeof value === "function") {
                        selectorCell.cx = cx;
                        selectorCell.cy = cy;
                        selectorCell.char = ch;
                        value = value(selectorCell);
                        if (value === null)
                            continue;
                    }
                    const x = cx * size;
                    const y = cy * size;
                    if (typeof value === "string") {
                        if (value !== lastFill) {
                            ctx.fillStyle = value;
                            lastFill = value;
                        }
                        fillPixelAligned(ctx, x, y, size, size);
                    }
                    else if (!isDualLayer(value)) {
                        if ((value.cols ?? 1) > 1 || (value.rows ?? 1) > 1) {
                            let stamp = stampPool[stampCount];
                            if (!stamp)
                                stampPool[stampCount] = stamp = { cell: value, x, y };
                            stamp.cell = value;
                            stamp.x = x;
                            stamp.y = y;
                            stampCount++;
                        }
                        else {
                            blitCell(ctx, value, x, y, size, size);
                        }
                    }
                }
            }
            // Multi-cell atlas stamps sit above ordinary terrain regardless of row
            // order, so a slope can overlap the solid dirt cells beneath it.
            for (let i = 0; i < stampCount; i++) {
                const { cell, x, y } = stampPool[i];
                blitCell(ctx, cell, x, y, size * (cell.cols ?? 1), size * (cell.rows ?? 1));
            }
        }
        finally {
            ctx.imageSmoothingEnabled = prevSmoothing;
        }
    }
    // ---------- Static-layer bake (opt-in via Draw.tiles' `bake`) ----------
    // One offscreen canvas covering the whole level, valid while the SAME skin
    // object is handed in and the camera scale stays within ±25% of the baked
    // one. `set()` and `invalidate()` drop it.
    const BAKE_MAX_PX = 4096; // device-px cap per axis for the offscreen canvas
    const BAKE_MAX_SCALE = 2; // bake resolution cap (device px per world px)
    let baked = null;
    let bakeDisabled = false; // level too large — warned once, live path forever
    /** Bake ALL cells (no culling) into an offscreen canvas at device scale
     *  min(camera scale, 2). Null when the level is too large (warned once) or
     *  no real canvas exists here (headless/jsdom — live path, silently). */
    function bakeLayer(skin, scale) {
        const deviceScale = Math.min(scale, BAKE_MAX_SCALE);
        const w = Math.max(1, Math.ceil(cols * size * deviceScale));
        const h = Math.max(1, Math.ceil(rows * size * deviceScale));
        if (w > BAKE_MAX_PX || h > BAKE_MAX_PX) {
            bakeDisabled = true;
            console.warn(`Tiles: level too large to bake (${w}x${h} device px); drawing per-tile`);
            return null;
        }
        let canvas;
        let bctx;
        try {
            canvas = scratchCanvas(w, h);
            bctx = scratchContext(canvas);
        }
        catch {
            return null;
        }
        if (!bctx)
            return null;
        bctx.scale(deviceScale, deviceScale);
        paintCells(bctx, skin, 0, 0, cols - 1, rows - 1);
        // Record the scale the pixels were actually baked at, not the camera's:
        // past BAKE_MAX_SCALE they diverge, and comparing against the camera's
        // would re-bake on zoom changes that produce identical pixels.
        return { canvas, scale: deviceScale, skinRef: skin };
    }
    return {
        invalidate() {
            baked = null;
        },
        render(ctx, skin, opts) {
            // Cull to the visible world rect, derived from the ctx's CURRENT
            // transform (whatever camera block we're inside) — zero API. The same
            // getTransform() yields the camera scale the bake path keys on.
            let x0 = 0;
            let y0 = 0;
            let x1 = cols - 1;
            let y1 = rows - 1;
            let scale = 1;
            if (typeof ctx.getTransform === "function") {
                try {
                    // Invert the affine transform by hand — one getTransform(), no
                    // DOMMatrix.inverse()/DOMPoint allocations per frame.
                    const m = ctx.getTransform();
                    scale = Math.hypot(m.a, m.b) || 1;
                    const c = ctx.canvas;
                    const det = m.a * m.d - m.b * m.c;
                    if (Number.isFinite(det) && det !== 0) {
                        // Inverse-map all FOUR screen corners and take their world AABB.
                        // Two corners suffice for a translate+scale transform, but not for
                        // a rotated one — its world-space bounding box is set by the other
                        // diagonal, so a two-corner box would under-cull and drop tiles.
                        //   x = (d*(sx-e) - c*(sy-f))/det,  y = (a*(sy-f) - b*(sx-e))/det
                        let minX = Infinity;
                        let minY = Infinity;
                        let maxX = -Infinity;
                        let maxY = -Infinity;
                        for (let i = 0; i < 4; i++) {
                            const sx = i & 1 ? c.width : 0;
                            const sy = i & 2 ? c.height : 0;
                            const dx = sx - m.e;
                            const dy = sy - m.f;
                            const wx = (m.d * dx - m.c * dy) / det;
                            const wy = (m.a * dy - m.b * dx) / det;
                            if (wx < minX)
                                minX = wx;
                            if (wx > maxX)
                                maxX = wx;
                            if (wy < minY)
                                minY = wy;
                            if (wy > maxY)
                                maxY = wy;
                        }
                        x0 = Math.max(0, Math.floor(minX / size));
                        y0 = Math.max(0, Math.floor(minY / size));
                        x1 = Math.min(cols - 1, Math.floor(maxX / size));
                        y1 = Math.min(rows - 1, Math.floor(maxY / size));
                    }
                }
                catch {
                    // DOMMatrix unavailable (tests/jsdom): draw everything.
                }
            }
            if (opts?.bake === true && !bakeDisabled) {
                // Compare like with like: `baked.scale` is the device scale the pixels
                // were rendered at, which is the camera scale CLAMPED to BAKE_MAX_SCALE.
                const wantScale = Math.min(scale, BAKE_MAX_SCALE);
                const stale = !baked ||
                    baked.skinRef !== skin ||
                    wantScale < baked.scale / 1.25 ||
                    wantScale > baked.scale * 1.25;
                if (stale)
                    baked = bakeLayer(skin, scale);
                if (baked) {
                    // One whole-level blit; the ambient transform positions it.
                    // Nearest-neighbour so pixel art stays crisp when the blit rescales.
                    const prev = ctx.imageSmoothingEnabled;
                    ctx.imageSmoothingEnabled = false;
                    blitPixelAligned(ctx, baked.canvas, 0, 0, cols * size, rows * size);
                    ctx.imageSmoothingEnabled = prev;
                    return;
                }
            }
            // A fixed region can begin outside the viewport and extend into it.
            // Include those anchors without making games manage tile culling.
            let overhangCols = 0;
            let overhangRows = 0;
            for (const value of Object.values(skin)) {
                if (value !== null && typeof value === "object" && !isDualLayer(value)) {
                    overhangCols = Math.max(overhangCols, (value.cols ?? 1) - 1);
                    overhangRows = Math.max(overhangRows, (value.rows ?? 1) - 1);
                }
            }
            x0 = Math.max(0, x0 - overhangCols);
            y0 = Math.max(0, y0 - overhangRows);
            paintCells(ctx, skin, x0, y0, x1, y1);
        },
    };
}
