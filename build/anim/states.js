// ---------- Multi-image state animations ----------
// The companion to `Anim.fromGrid` for the OTHER common art layout: one image PER
// STATE (a sprite kit shipped as `idle.png`, `run.png`, `jump.png`, …), rather
// than every state packed into one grid. Each state's image is a horizontal
// strip of `frames` cells (or a single static frame).
//
//   const hero = Anim.fromImages({
//     idle: { image: art.idle, frames: 4, fps: 6 },
//     run:  { image: art.run,  frames: 6, fps: 12 },
//     jump: { image: art.jump },                       // 1 static frame
//   });
//   const anim = hero.play("idle");
//   anim.set(grounded ? "run" : "jump");    // typed; same-state is a NO-OP
//   Draw.sprite(anim, player, { flipX });    // SpriteLike: the image switches
//
// A kit is shared, immutable config; a CURSOR (`hero.play("idle")`) is a cheap
// per-entity playback head — a hundred goblins share one kit. Like `Anim.fromGrid`
// the cursor is pull-derived (API_PLAN law 4): the frame comes from the clock on
// read, so nothing ticks, holding the clock freezes it, and calling `set` with
// the current state every step never restarts the loop.
/** Assemble named states, each from its own image, into a shared kit. */
export function fromImages(clips, options = {}) {
    const sourceClock = options.clock;
    const scratch = { sx: 0, sy: 0, sw: 0, sh: 0 };
    const frameCount = (clip) => Math.max(1, clip.frames ?? 1);
    const cellW = (clip) => clip.frame?.w ?? clip.image.width / frameCount(clip);
    const cellH = (clip) => clip.frame?.h ?? clip.image.height;
    function rectFor(state, frame) {
        const clip = clips[state];
        const n = frameCount(clip);
        const f = Math.max(0, Math.min(frame, n - 1));
        const fw = cellW(clip);
        scratch.sx = f * fw;
        scratch.sy = 0;
        scratch.sw = fw;
        scratch.sh = cellH(clip);
        return scratch;
    }
    const makeCursor = (initial, playOpts, loop) => {
        if (!clips[initial])
            throw new Error(`Anim.fromImages: unknown state "${initial}"`);
        const clock = playOpts.clock ?? sourceClock;
        if (!clock) {
            throw new Error("Anim.fromImages: playback needs a clock; pass one explicitly or use createAnimation(app)");
        }
        let state = initial;
        let start = clock.now;
        let pausedAt;
        const now = () => pausedAt ?? clock.now;
        const frameIndex = () => {
            const clip = clips[state];
            const n = frameCount(clip);
            if (n === 1)
                return 0;
            const fps = clip.fps ?? 12;
            const idx = Math.floor(((now() - start) * fps) / 1000);
            return loop ? idx % n : Math.min(idx, n - 1);
        };
        const sheetFacade = {
            get image() {
                return clips[state].image;
            },
        };
        const cursor = {
            sheet: sheetFacade,
            get state() {
                return state;
            },
            set(next) {
                if (next !== state) {
                    if (!clips[next])
                        throw new Error(`Anim.fromImages: unknown state "${next}"`);
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
                const clip = clips[state];
                const n = frameCount(clip);
                const fps = clip.fps ?? 12;
                return now() - start >= (n * 1000) / fps;
            },
        };
        return cursor;
    };
    const self = {
        rect: rectFor,
        image(state) {
            return clips[state].image;
        },
        once(initial, playOpts = {}) {
            return makeCursor(initial, playOpts, false);
        },
        play(initial, playOpts = {}) {
            return makeCursor(initial, playOpts, true);
        },
    };
    return self;
}
