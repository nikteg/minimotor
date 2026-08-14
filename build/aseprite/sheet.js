// ---------- Aseprite sheet implementation ----------
// Aseprite sprite-sheet JSON: static atlas frames, tagged animation, per-frame
// timing, trim placement, layers, slices, pivots, and nine-slice centers.
// `Aseprite.sheet(image, json)` is also what `Assets.load({ aseprite })`
// composes automatically.
const tagOrder = (tag, count) => {
    if (!Number.isInteger(tag.from) ||
        !Number.isInteger(tag.to) ||
        tag.from < 0 ||
        tag.to < tag.from ||
        tag.to >= count) {
        throw new Error(`Aseprite.sheet: tag "${tag.name}" has an invalid frame range`);
    }
    const forward = Array.from({ length: tag.to - tag.from + 1 }, (_, i) => tag.from + i);
    const reverse = [...forward].reverse();
    if (tag.direction === "reverse")
        return reverse;
    if (tag.direction === "pingpong")
        return [...forward, ...reverse.slice(1, -1)];
    if (tag.direction === "pingpong_reverse")
        return [...reverse, ...forward.slice(1, -1)];
    return forward;
};
/** Read Aseprite CLI JSON (array or hash format) as a pull-derived animation sheet. */
export function sheet(image, data, options = {}) {
    const sheetClock = options.clock;
    const entries = Array.isArray(data.frames)
        ? data.frames.map((frame, index) => [frame.filename ?? String(index), frame])
        : Object.entries(data.frames);
    const source = entries.map(([, frame]) => frame);
    if (source.length === 0)
        throw new Error("Aseprite.sheet: no frames");
    const frames = source.map((entry, index) => {
        if (entry.rotated) {
            throw new Error(`Aseprite.sheet: frame ${index} is rotated; disable atlas rotation`);
        }
        const { x, y, w, h } = entry.frame;
        if (![x, y, w, h, entry.duration].every(Number.isFinite) ||
            w <= 0 ||
            h <= 0 ||
            entry.duration <= 0) {
            throw new Error(`Aseprite.sheet: frame ${index} has invalid geometry or duration`);
        }
        const sourceSize = entry.sourceSize;
        const offset = entry.spriteSourceSize;
        if (entry.trimmed &&
            (!sourceSize ||
                !offset ||
                ![sourceSize.w, sourceSize.h, offset.x, offset.y].every(Number.isFinite))) {
            throw new Error(`Aseprite.sheet: trimmed frame ${index} has no source placement`);
        }
        return {
            index,
            name: entries[index][0],
            rect: {
                sx: x,
                sy: y,
                sw: w,
                sh: h,
                ...(entry.trimmed
                    ? {
                        sourceW: sourceSize.w,
                        sourceH: sourceSize.h,
                        offsetX: offset.x,
                        offsetY: offset.y,
                    }
                    : {}),
            },
            duration: entry.duration,
        };
    });
    const clips = new Map();
    for (const tag of data.meta?.frameTags ?? []) {
        const key = tag.name;
        if (clips.has(key))
            throw new Error(`Aseprite.sheet: duplicate tag "${tag.name}"`);
        const selected = tagOrder(tag, frames.length).map((index) => frames[index]);
        clips.set(key, {
            frames: selected,
            duration: selected.reduce((sum, frame) => sum + frame.duration, 0),
        });
    }
    const states = [...clips.keys()];
    const first = frames[0].rect;
    const scratch = { ...first };
    const byName = new Map(frames.map((frame) => [frame.name, frame]));
    const slices = new Map((data.meta?.slices ?? []).map((slice) => [
        slice.name,
        { ...slice, keys: [...slice.keys].sort((a, b) => a.frame - b.frame) },
    ]));
    const make = (sheetImage) => {
        const copy = (value) => {
            for (const key of Object.keys(scratch))
                delete scratch[key];
            Object.assign(scratch, value);
            return scratch;
        };
        const rectFor = (state, frame) => {
            const clip = clips.get(state);
            if (!clip)
                throw new Error(`Aseprite.sheet: unknown state "${state}"`);
            const value = clip.frames[Math.max(0, Math.min(frame, clip.frames.length - 1))].rect;
            return copy(value);
        };
        const sheet = {
            image: sheetImage,
            frame: { w: first.sourceW ?? first.sw, h: first.sourceH ?? first.sh },
            states,
            frames: frames.map((frame) => frame.name),
            layers: data.meta?.layers ?? [],
            slices: [...slices.keys()],
            rect: rectFor,
            region(frame) {
                const value = typeof frame === "number" ? frames[frame] : byName.get(frame);
                if (!value)
                    throw new Error(`Aseprite.sheet: unknown frame "${frame}"`);
                return copy(value.rect);
            },
            sprite(frame) {
                return {
                    sheet: { image: sheetImage },
                    rect: { ...sheet.region(frame) },
                };
            },
            slice(name, frame = 0) {
                const keys = slices.get(name)?.keys;
                if (!keys)
                    throw new Error(`Aseprite.sheet: unknown slice "${name}"`);
                let value;
                for (const key of keys) {
                    if (key.frame > frame)
                        break;
                    value = key;
                }
                return value;
            },
            withImage: make,
            once(initial, playOptions) {
                return makeCursor(initial, playOptions, false);
            },
            play(initial, playOptions) {
                return makeCursor(initial, playOptions, true);
            },
        };
        const makeCursor = (initial, playOptions, loop) => {
            if (!clips.has(initial))
                throw new Error(`Aseprite.sheet: unknown state "${initial}"`);
            const clock = playOptions.clock ?? sheetClock;
            if (!clock) {
                throw new Error("Aseprite.sheet: playback needs a clock; pass one explicitly or use Animation.play(source, state)");
            }
            let state = initial;
            let start = clock.now;
            let pausedAt;
            const now = () => pausedAt ?? clock.now;
            const elapsed = () => Math.max(0, now() - start);
            const current = () => {
                const clip = clips.get(state);
                const time = loop
                    ? elapsed() % clip.duration
                    : Math.min(elapsed(), Math.max(0, clip.duration - Number.EPSILON));
                let at = 0;
                for (let index = 0; index < clip.frames.length; index++) {
                    at += clip.frames[index].duration;
                    if (time < at)
                        return { clip, index };
                }
                return { clip, index: clip.frames.length - 1 };
            };
            const cursor = {
                sheet,
                get state() {
                    return state;
                },
                set(next) {
                    if (next !== state) {
                        if (!clips.has(next))
                            throw new Error(`Aseprite.sheet: unknown state "${next}"`);
                        state = next;
                        start = now();
                    }
                },
                reset() {
                    start = now();
                },
                pause() {
                    pausedAt ?? (pausedAt = clock.now);
                },
                resume() {
                    if (pausedAt === undefined)
                        return;
                    start += clock.now - pausedAt;
                    pausedAt = undefined;
                },
                get paused() {
                    return pausedAt !== undefined;
                },
                get frame() {
                    return current().index;
                },
                get sourceFrame() {
                    const value = current();
                    return value.clip.frames[value.index].index;
                },
                get rect() {
                    return rectFor(state, current().index);
                },
                slice(name) {
                    const value = current();
                    return sheet.slice(name, value.clip.frames[value.index].index);
                },
                get done() {
                    const clip = clips.get(state);
                    return !loop && elapsed() >= clip.duration;
                },
            };
            return cursor;
        };
        return sheet;
    };
    return make(image);
}
