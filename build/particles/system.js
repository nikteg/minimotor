// ---------- Particle system implementation ----------
// A tiny CPU particle system for impact/juice — death bursts, coin sparkles,
// dust. Particles are short-lived colored dots with velocity, optional gravity
// and a fade-out. Deliberately simpler than the ECS: a flat pooled array, no
// components — high churn, no queries, so plain data wins.
//
// Particle systems are game CONTENT (API_PLAN law 5): create as many as the
// draw order needs (dust behind the player, sparks in front), drop one to
// tear it down. Simulation folds forward from the system's clock on read —
// paused clock, frozen particles — and only DRAWING is explicit:
//
//   const fx = Particles.createSystem();
//   fx.burst({ at: coin, count: 12, speed: [1, 3], life: [200, 400] });
//   fx.emit({ at: torch, chance: 0.4, color: "#f80" });  // per-step, immediate-mode
//   // in the world pass:  Draw.particles(fx);
//
// Units: speeds in px/step, gravity px/step², lifetimes in ms.
import { lruCache } from "../cache/lruCache.js";
import { lazySteps } from "../clock/lazySteps.js";
import { scratchCanvas, scratchContext } from "../engine/offscreen.js";
/** One full-shape literal so every particle shares a single hidden class. */
function makeParticle() {
    return { x: 0, y: 0, vx: 0, vy: 0, age: 0, life: 0, size: 0, color: "", gravity: 0, dot: null };
}
function sample(r, rng) {
    return typeof r === "number" ? r : r[0] + rng() * (r[1] - r[0]);
}
// Pre-baked circle per color: a drawImage blit is much cheaper than a
// beginPath/arc/fill per particle, and it carries its color (no fillStyle
// churn). LRU-bounded so dynamic color strings can't grow it forever — but
// per-frame-computed colors still churn re-bakes, so prefer a fixed set.
const DOT_R = 16;
const dotCache = lruCache(64);
function dotFor(color) {
    let dot = dotCache.get(color);
    if (dot === undefined) {
        dot = null;
        try {
            const c = scratchCanvas(DOT_R * 2, DOT_R * 2);
            const g = scratchContext(c);
            if (g) {
                g.fillStyle = color;
                g.beginPath();
                g.arc(DOT_R, DOT_R, DOT_R, 0, Math.PI * 2);
                g.fill();
                dot = c;
            }
        }
        catch {
            dot = null; // no canvas support (tests) — fall back to path fills
        }
        dotCache.set(color, dot);
    }
    return dot;
}
const MAX_FOLD_STEPS = 240;
// Literal option defaults, hoisted so a burst doesn't re-create the tuples
// (and re-resolve every `??`) once per particle.
const DEFAULT_SPEED = [0.7, 2];
const DEFAULT_SIZE = [2, 4];
const DEFAULT_LIFE = 600;
const DEFAULT_COLOR = "#fff";
/** Create a standalone particle system. Its simulation is pull-derived from
 * `options.clock`; pass `options.rng` to make emission deterministic in tests.
 * App code normally uses `createParticles(app).createSystem()`. */
export function createParticleSystem(options) {
    const rng = options.rng ?? Math.random;
    const clock = options.clock;
    const stepMs = clock.step;
    const live = [];
    const pool = []; // dead particles, reused by the next burst
    const pendingSteps = lazySteps(() => clock.now, stepMs, MAX_FOLD_STEPS);
    /** Fold the simulation forward by the clock time elapsed since last read. */
    function updatePending() {
        let steps = pendingSteps.take();
        while (steps-- > 0) {
            for (let i = live.length - 1; i >= 0; i--) {
                const p = live[i];
                p.age += stepMs;
                if (p.age >= p.life) {
                    const last = live.pop();
                    if (i < live.length)
                        live[i] = last;
                    pool.push(p);
                    continue;
                }
                p.vy += p.gravity;
                p.x += p.vx;
                p.y += p.vy;
            }
        }
    }
    /** Resolve the option defaults ONCE, then spawn `count` particles. */
    function spawn(opts, count) {
        const x = opts.at.x;
        const y = opts.at.y;
        const angle = opts.angle ?? 0;
        const spread = opts.spread ?? Math.PI * 2;
        const speed = opts.speed ?? DEFAULT_SPEED;
        const size = opts.size ?? DEFAULT_SIZE;
        const life = opts.life ?? DEFAULT_LIFE;
        const gravity = opts.gravity ?? 0;
        const color = opts.color ?? DEFAULT_COLOR;
        for (let i = 0; i < count; i++) {
            const dir = angle + (rng() - 0.5) * spread;
            const spd = sample(speed, rng);
            const p = pool.pop() ?? makeParticle();
            p.x = x;
            p.y = y;
            p.vx = Math.cos(dir) * spd;
            p.vy = Math.sin(dir) * spd;
            p.age = 0;
            p.life = sample(life, rng);
            p.size = sample(size, rng);
            p.color = typeof color === "string" ? color : color[(rng() * color.length) | 0];
            p.gravity = gravity;
            p.dot = dotFor(p.color);
            live.push(p);
        }
    }
    return {
        burst(opts) {
            updatePending(); // fresh particles must not inherit backlog aging
            spawn(opts, opts.count ?? 12);
        },
        emit(opts) {
            updatePending();
            if (rng() < (opts.chance ?? 1))
                spawn(opts, 1);
        },
        render(ctx) {
            updatePending();
            for (const p of live) {
                ctx.globalAlpha = Math.max(0, 1 - p.age / p.life);
                if (p.dot) {
                    ctx.drawImage(p.dot, p.x - p.size, p.y - p.size, p.size * 2, p.size * 2);
                }
                else {
                    ctx.fillStyle = p.color;
                    ctx.beginPath();
                    ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
                    ctx.fill();
                }
            }
            ctx.globalAlpha = 1;
        },
        clear() {
            // Recycle, don't drop — cleared particles feed the next burst.
            for (const p of live)
                pool.push(p);
            live.length = 0;
        },
        get count() {
            updatePending();
            return live.length;
        },
    };
}
