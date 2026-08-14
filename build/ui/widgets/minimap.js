import { LADDER } from "../../tiles/presets.js";
import { uiCtx } from "../../ui/core/index.js";
/** Draw a complete semantic level overview with slopes, markers, and viewport. */
export function minimap(level, options) {
    const ctx = uiCtx();
    const map = options.at;
    const sx = map.w / level.rect.w;
    const sy = map.h / level.rect.h;
    const mx = (x) => map.x + (x - level.rect.x) * sx;
    const my = (y) => map.y + (y - level.rect.y) * sy;
    const color = options.tile ??
        ((cell) => cell.spec.tags?.includes(LADDER) ? "#e8b56a" : cell.spec.oneWay ? "#d59b63" : "#665b86");
    ctx.save();
    ctx.beginPath();
    ctx.rect(map.x, map.y, map.w, map.h);
    ctx.clip();
    ctx.fillStyle = options.background ?? "#1d1b32";
    ctx.fillRect(map.x, map.y, map.w, map.h);
    for (let row = 0; row < level.rows; row++) {
        for (let col = 0; col < level.cols; col++) {
            const tile = level.at(col, row);
            const spec = level.legend[tile];
            if (!spec)
                continue;
            const fill = typeof color === "function" ? color({ col, row, tile, spec }) : color;
            if (!fill)
                continue;
            const [cols, rows] = level.span(tile);
            const x = mx(level.rect.x + col * level.size);
            const y = my(level.rect.y + row * level.size);
            const w = level.size * cols * sx;
            const h = level.size * rows * sy;
            ctx.fillStyle = fill;
            if (spec.slope) {
                ctx.beginPath();
                if (spec.slope === "up-right") {
                    ctx.moveTo(x, y + h);
                    ctx.lineTo(x + w, y);
                    ctx.lineTo(x + w, y + h);
                }
                else {
                    ctx.moveTo(x, y);
                    ctx.lineTo(x + w, y + h);
                    ctx.lineTo(x, y + h);
                }
                ctx.closePath();
                ctx.fill();
            }
            else {
                ctx.fillRect(x, y, w + 0.25, h + 0.25);
            }
        }
    }
    for (const point of options.points ?? []) {
        const size = point.size ?? 3;
        const x = mx(point.x);
        const y = my(point.y);
        if (point.outline) {
            ctx.fillStyle = point.outline;
            ctx.fillRect(x - size / 2 - 1, y - size / 2 - 1, size + 2, size + 2);
        }
        ctx.fillStyle = point.color;
        ctx.fillRect(x - size / 2, y - size / 2, size, size);
    }
    if (options.view) {
        ctx.strokeStyle = options.viewColor ?? "rgba(255,255,255,.55)";
        ctx.lineWidth = 1;
        ctx.strokeRect(mx(options.view.x), my(options.view.y), options.view.w * sx, options.view.h * sy);
    }
    ctx.restore();
}
