const rate = (perSec) => Math.round(perSec);
const kbps = (bps) => (bps / 1024).toFixed(1);
const HORIZONTAL_GAP = 10;
function drawHorizontalPerfHud(ctx, stats, opts) {
    const fpsColor = stats.fps >= 55 ? "#4ecdc4" : stats.fps >= 30 ? "#ffd43b" : "#ff6b6b";
    const primary = [
        { text: `FPS ${stats.fps}`, color: fpsColor, width: 52 },
        { text: `FRAME ${stats.frameMs} ms`, color: "#aaa", width: 82 },
        { text: `MIN ${stats.minMs} · MAX ${stats.maxMs} ms`, color: "#777", width: 120 },
    ];
    const secondary = [];
    if (opts.timings) {
        const { updateMs, drawMs, steps } = opts.timings;
        primary.push({
            text: `UPDATE ${updateMs.toFixed(1)} · DRAW ${drawMs.toFixed(1)} ms${steps > 1 ? ` ×${steps}` : ""}`,
            color: "#aaa",
            width: 166,
        });
    }
    if (opts.entities !== undefined || opts.heapMB !== undefined) {
        const parts = [];
        if (opts.entities !== undefined)
            parts.push(`ENTITIES ${opts.entities}`);
        if (opts.heapMB !== undefined)
            parts.push(`HEAP ${Math.round(opts.heapMB)} MB`);
        secondary.push({ text: parts.join(" · "), color: "#aaa", width: 174 });
    }
    if (opts.render3d) {
        const r = opts.render3d;
        secondary.push({
            text: `3D ${r.backend} · ${r.viewports}v · ${r.drawCalls} draws · ${compact(r.triangles)} tris · ${r.culled} culled · CPU ${r.cpuMs.toFixed(1)} ms · GPU ${r.gpuMs === undefined ? "—" : `${r.gpuMs.toFixed(1)} ms`}`,
            color: "#8be0d0",
            width: 390,
        });
    }
    if (opts.net) {
        secondary.push({
            text: `SENT ${kbps(opts.net.upBps)} KB/s · ${rate(opts.net.upMsgs)} msg/s`,
            color: "#4ecdc4",
            width: 156,
        }, {
            text: `RECEIVED ${kbps(opts.net.downBps)} KB/s · ${rate(opts.net.downMsgs)} msg/s`,
            color: "#ffd43b",
            width: 180,
        });
    }
    const rows = secondary.length ? [primary, secondary] : [primary];
    const sparks = [
        opts.graphs?.frame && { spark: opts.graphs.frame, label: "frame ms", color: "#b197fc" },
        opts.render3d &&
            opts.graphs?.render3d && {
            spark: opts.graphs.render3d,
            label: "3D CPU ms",
            color: "#ff9f43",
        },
        opts.render3d &&
            opts.graphs?.render3dGpu && {
            spark: opts.graphs.render3dGpu,
            label: "3D GPU ms",
            color: "#ff6b9d",
        },
        opts.net && opts.graphs?.up && { spark: opts.graphs.up, label: "sent KB/s", color: "#4ecdc4" },
        opts.net &&
            opts.graphs?.down && {
            spark: opts.graphs.down,
            label: "received KB/s",
            color: "#ffd43b",
        },
    ].filter(Boolean);
    ctx.save();
    ctx.font = "10px monospace";
    ctx.textBaseline = "top";
    ctx.textAlign = "left";
    const maxBoxW = opts.viewW === undefined ? Number.POSITIVE_INFINITY : Math.max(1, opts.viewW - 8);
    const maxTextW = maxBoxW === Number.POSITIVE_INFINITY ? maxBoxW : Math.max(1, maxBoxW - 8);
    const layoutRows = rows.flatMap((segments) => wrapHorizontalRow(ctx, segments, maxTextW));
    const textW = Math.max(...layoutRows.map((segments) => segments.reduce((sum, segment) => sum + segment.width, 0) +
        Math.max(0, segments.length - 1) * HORIZONTAL_GAP));
    const boxW = Math.ceil(Math.min(maxBoxW, Math.max(textW + 8, sparks.length ? 300 : 0)));
    const textH = 10 + layoutRows.length * 14;
    const boxH = textH + (sparks.length ? 30 : 0);
    const bgX = (opts.anchor ?? "top-right") === "top-right" && opts.viewW !== undefined
        ? opts.viewW - 4 - boxW
        : 4;
    const bgY = 4;
    ctx.fillStyle = "rgba(0,0,0,0.55)";
    ctx.fillRect(bgX, bgY, boxW, boxH);
    layoutRows.forEach((segments, row) => {
        let x = bgX + 4;
        segments.forEach((segment, index) => {
            ctx.fillStyle = segment.color;
            ctx.fillText(segment.text, x, bgY + 7 + row * 14);
            if (index < segments.length - 1)
                x += segment.width + HORIZONTAL_GAP;
        });
    });
    if (sparks.length) {
        const graphGap = 4;
        const graphW = (boxW - 8 - graphGap * (sparks.length - 1)) / sparks.length;
        sparks.forEach(({ spark, label, color }, index) => {
            const graphX = bgX + 4 + index * (graphW + graphGap);
            ctx.font = "9px monospace";
            ctx.fillStyle = color;
            ctx.fillText(label, graphX, bgY + textH - 1);
            spark.draw(ctx, graphX, bgY + textH + 9, graphW, 16, color);
        });
    }
    ctx.restore();
    return { x: bgX, y: bgY, w: boxW, h: boxH };
}
/** Measure and wrap a horizontal row without letting a long metric line run
 * past the HUD. The separator-aware split keeps the 3D counters readable on
 * a narrow phone while preserving the compact single-line form on desktop. */
function wrapHorizontalRow(ctx, segments, maxWidth) {
    const lines = [[]];
    let lineWidth = 0;
    for (const segment of segments) {
        const fullWidth = Math.max(segment.width, ctx.measureText(segment.text).width);
        const currentGap = lines[lines.length - 1].length ? HORIZONTAL_GAP : 0;
        if (fullWidth <= maxWidth) {
            if (lineWidth > 0 && lineWidth + currentGap + fullWidth > maxWidth) {
                lines.push([]);
                lineWidth = 0;
            }
            lines[lines.length - 1].push({ ...segment, width: fullWidth });
            lineWidth += (lines[lines.length - 1].length > 1 ? HORIZONTAL_GAP : 0) + fullWidth;
            continue;
        }
        const delimiter = segment.text.includes(" · ") ? " · " : " ";
        const tokens = segment.text.split(delimiter);
        for (const token of tokens) {
            const measured = ctx.measureText(token).width;
            const width = Math.max(1, measured);
            const gap = lines[lines.length - 1].length ? HORIZONTAL_GAP : 0;
            if (lineWidth > 0 && lineWidth + gap + width > maxWidth) {
                lines.push([]);
                lineWidth = 0;
            }
            const current = lines[lines.length - 1];
            current.push({ text: token, color: segment.color, width });
            lineWidth += (current.length > 1 ? HORIZONTAL_GAP : 0) + width;
        }
    }
    return lines;
}
/** Draw a compact perf HUD. Defaults to the top-right corner (pass `viewW` so it
 *  can anchor there); call after your own draw code. Returns the drawn box rect. */
export function drawPerfHud(ctx, stats, opts = {}) {
    if (opts.layout === "horizontal")
        return drawHorizontalPerfHud(ctx, stats, opts);
    const net = opts.net;
    const timings = opts.timings;
    const render3d = opts.render3d;
    const anchor = opts.anchor ?? "top-right";
    const lineH = 14;
    // The 3D line is the widest thing here and its width is not knowable in
    // advance — a backend name, six counts and two millisecond figures, any of
    // which can grow a digit. Build it first and measure it, or the box is a
    // guess that the text runs out of: anchored right, the overflow leaves the
    // screen entirely. The font has to be set before measuring, so it is set
    // here rather than after the background is filled.
    ctx.save();
    ctx.font = "11px monospace";
    const render3dLine = render3d
        ? `3d ${render3d.backend}  ${render3d.viewports}v  ${render3d.drawCalls} draws  ${compact(render3d.triangles)} tris  ${render3d.culled} culled  cpu ${render3d.cpuMs.toFixed(1)} ms  gpu ${render3d.gpuMs === undefined ? "—" : `${render3d.gpuMs.toFixed(1)} ms`}`
        : "";
    const boxW = render3d
        ? Math.max(390, Math.ceil(ctx.measureText(render3dLine).width) + 12)
        : net
            ? 176
            : 148;
    const memLine = opts.entities !== undefined || opts.heapMB !== undefined;
    const rows = 4 + (timings ? 1 : 0) + (memLine ? 1 : 0) + (render3d ? 1 : 0) + (net ? 2 : 0);
    const frameSpark = opts.graphs?.frame;
    const render3dSpark = render3d && opts.graphs?.render3d;
    const render3dGpuSpark = render3d && opts.graphs?.render3dGpu;
    const upSpark = net && opts.graphs?.up;
    const downSpark = net && opts.graphs?.down;
    // Each graph is a labeled strip: 10px caption + 16px bars + 4px gap.
    const graphH = 16;
    const stripH = 10 + graphH + 4;
    let boxH = lineH * rows + 8;
    if (frameSpark)
        boxH += stripH;
    if (render3dSpark)
        boxH += stripH;
    if (render3dGpuSpark)
        boxH += stripH;
    if (upSpark)
        boxH += stripH;
    if (downSpark)
        boxH += stripH;
    // Anchor to the right edge when we know the width; otherwise fall back to left.
    const bgX = anchor === "top-right" && opts.viewW !== undefined ? opts.viewW - 4 - boxW : 4;
    const bgY = 4;
    const x = bgX + 4;
    const y = 8;
    // The HUD changes font/baseline/align/fillStyle; the `save` above pairs with
    // the `restore` below so no state leaks into the next frame's user draw (a
    // leaked textBaseline shifts every fillText in the whole app).
    ctx.fillStyle = "rgba(0,0,0,0.55)";
    ctx.fillRect(bgX, bgY, boxW, boxH);
    ctx.textBaseline = "top";
    ctx.textAlign = "left";
    const color = stats.fps >= 55 ? "#4ecdc4" : stats.fps >= 30 ? "#ffd43b" : "#ff6b6b";
    ctx.fillStyle = color;
    ctx.fillText(`FPS  ${stats.fps}`, x, y);
    ctx.fillStyle = "#aaa";
    ctx.fillText(`frame  ${stats.frameMs} ms`, x, y + lineH);
    ctx.fillText(`min   ${stats.minMs} ms`, x, y + lineH * 2);
    ctx.fillText(`max   ${stats.maxMs} ms`, x, y + lineH * 3);
    let row = 4;
    if (timings) {
        // What the frame time was spent on: your update steps vs your draw. `×N`
        // marks catch-up frames that ran more than one fixed step.
        const upd = timings.updateMs.toFixed(1);
        const drw = timings.drawMs.toFixed(1);
        const xn = timings.steps > 1 ? `  ×${timings.steps}` : "";
        ctx.fillText(`upd ${upd}  drw ${drw} ms${xn}`, x, y + lineH * row++);
    }
    if (memLine) {
        const parts = [];
        if (opts.entities !== undefined)
            parts.push(`ents ${opts.entities}`);
        if (opts.heapMB !== undefined)
            parts.push(`heap ${Math.round(opts.heapMB)} MB`);
        ctx.fillText(parts.join("  "), x, y + lineH * row++);
    }
    if (render3d) {
        ctx.fillStyle = "#8be0d0";
        ctx.fillText(render3dLine, x, y + lineH * row++);
    }
    if (net) {
        ctx.fillStyle = "#4ecdc4";
        ctx.fillText(`↑ ${rate(net.upMsgs)}/s  ${kbps(net.upBps)} KB/s`, x, y + lineH * row++);
        ctx.fillStyle = "#ffd43b";
        ctx.fillText(`↓ ${rate(net.downMsgs)}/s  ${kbps(net.downBps)} KB/s`, x, y + lineH * row++);
    }
    // Labeled history strips, one metric per graph — each in its own color so
    // they can't be confused at a glance.
    let graphY = bgY + lineH * rows + 8;
    const graphW = boxW - 8;
    const strip = (spark, label, barColor) => {
        ctx.font = "9px monospace";
        ctx.fillStyle = barColor;
        ctx.fillText(label, x, graphY);
        spark.draw(ctx, x, graphY + 10, graphW, graphH, barColor);
        graphY += stripH;
    };
    if (frameSpark)
        strip(frameSpark, "frame ms", "#b197fc");
    if (render3dSpark)
        strip(render3dSpark, "3D CPU ms", "#ff9f43");
    if (render3dGpuSpark)
        strip(render3dGpuSpark, "3D GPU ms", "#ff6b9d");
    if (upSpark)
        strip(upSpark, "↑ sent KB/s", "#4ecdc4");
    if (downSpark)
        strip(downSpark, "↓ received KB/s", "#ffd43b");
    ctx.restore();
    return { x: bgX, y: bgY, w: boxW, h: boxH };
}
function compact(value) {
    if (value < 1000)
        return String(value);
    if (value < 1000000)
        return `${(value / 1000).toFixed(value < 10000 ? 1 : 0)}k`;
    return `${(value / 1000000).toFixed(1)}m`;
}
