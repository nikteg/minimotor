const WINDOW = 60; // frames of history (matches the perf tracker)
/** Create a fixed-capacity sparkline backed by a ring buffer — `capacity`
 *  samples of history (default `WINDOW`), no allocations after creation. */
export function createSparkline(capacity = WINDOW) {
    const vals = new Float64Array(capacity);
    let head = 0; // next slot to overwrite
    let count = 0;
    return {
        push(v) {
            vals[head] = v;
            head = (head + 1) % capacity;
            if (count < capacity)
                count++;
        },
        draw(ctx, x, y, w, h, color) {
            if (count === 0)
                return;
            let max = 0;
            for (let i = 0; i < count; i++)
                if (vals[i] > max)
                    max = vals[i];
            if (max <= 0)
                max = 1;
            const bw = w / capacity;
            ctx.fillStyle = color;
            // Oldest sample first, newest ending flush with the right edge.
            for (let i = 0; i < count; i++) {
                const v = vals[(head - count + i + 2 * capacity) % capacity];
                const bh = Math.max(1, (v / max) * h);
                ctx.fillRect(x + (capacity - count + i) * bw, y + h - bh, Math.max(1, bw - 1), bh);
            }
        },
    };
}
