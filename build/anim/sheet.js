// ---------- Sprite sheets ----------
// A sheet is shared, immutable config: image + frame size + named states
// (one grid row per state). A CURSOR (`sheet.play("idle")`) is a cheap
// per-entity playback head — a hundred goblins share one sheet.
//
//   const heroSheet = Anim.fromGrid(art.hero, {
//     frame: { w: 32, h: 32 },
//     states: {
//       idle: { row: 0, frames: 4, fps: 6 },
//       run:  { row: 1, frames: 6, fps: 12 },
//       jump: { row: 2, frames: 1 },
//     },
//   });
//   const anim = heroSheet.play("idle");
//   anim.set(grounded ? "run" : "jump");    // typed; same-state is a NO-OP
//   Draw.sprite(anim, player, { flipX });
//
// Cursors are pull-derived (API_PLAN law 4): the frame is computed from the
// clock on read — nothing ticks, holding the clock freezes every cursor, and
// calling `set` with the current state every step never restarts the loop
// (the classic stuck-on-frame-0 bug can't be written).
/** Slice an image into a named-state sprite sheet. */
export function fromGrid(image, opts) {
    const sourceClock = opts.clock;
    const fw = opts.frame.w;
    const fh = opts.frame.h;
    const states = opts.states;
    const scratch = { sx: 0, sy: 0, sw: fw, sh: fh };
    function rectFor(state, frame) {
        const spec = states[state];
        const n = Math.max(1, spec.frames);
        const f = Math.max(0, Math.min(frame, n - 1));
        scratch.sx = f * fw;
        scratch.sy = spec.row * fh;
        scratch.sw = fw;
        scratch.sh = fh;
        return scratch;
    }
    const makeCursor = (initial, playOpts, loop) => {
        if (!states[initial])
            throw new Error(`Anim.fromGrid: unknown state "${initial}"`);
        const clock = playOpts.clock ?? sourceClock;
        if (!clock) {
            throw new Error("Anim.fromGrid: playback needs a clock; pass one explicitly or use createAnimation(app)");
        }
        let state = initial;
        let start = clock.now;
        let pausedAt;
        const now = () => pausedAt ?? clock.now;
        const frameIndex = () => {
            const spec = states[state];
            const n = Math.max(1, spec.frames);
            if (n === 1)
                return 0;
            const fps = spec.fps ?? 12;
            const idx = Math.floor(((now() - start) * fps) / 1000);
            return loop ? idx % n : Math.min(idx, n - 1);
        };
        const cursor = {
            sheet: self,
            get state() {
                return state;
            },
            set(next) {
                if (next !== state) {
                    if (!states[next])
                        throw new Error(`Anim.fromGrid: unknown state "${next}"`);
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
                return frameIndex();
            },
            get rect() {
                return rectFor(state, frameIndex());
            },
            get done() {
                if (loop)
                    return false;
                const spec = states[state];
                const n = Math.max(1, spec.frames);
                const fps = spec.fps ?? 12;
                return now() - start >= (n * 1000) / fps;
            },
        };
        return cursor;
    };
    const self = {
        image,
        frame: { w: fw, h: fh },
        rect: rectFor,
        once(initial, playOpts = {}) {
            return makeCursor(initial, playOpts, false);
        },
        play(initial, playOpts = {}) {
            return makeCursor(initial, playOpts, true);
        },
    };
    return self;
}
