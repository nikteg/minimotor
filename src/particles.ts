// ---------- Particles ----------
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
//   const fx = Particles.create();
//   fx.burst({ at: coin, count: 12, speed: [1, 3], life: [200, 400] });
//   fx.emit({ at: torch, chance: 0.4, color: "#f80" });  // per-step, immediate-mode
//   // in the world pass:  Draw.particles(fx);
//
// Units: speeds in px/step, gravity px/step², lifetimes in ms.

import { Clock, type ClockHandle } from "./clock.js";

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  age: number;
  life: number;
  size: number;
  color: string;
  gravity: number;
}

/** A `number` (fixed) or an inclusive `[min, max]` range to sample from —
 *  tuples mean randomness, engine-wide. */
export type Range = number | [number, number];

/** Options for a `burst`. All optional except `at` — defaults give a small
 *  round puff. */
export interface BurstOptions {
  /** Emission point — anything with x/y (a coin's component data, a body). */
  at: { x: number; y: number };
  /** How many particles to emit (default 12). */
  count?: number;
  /** Emission direction in radians (default 0 = +x). */
  angle?: number;
  /** Angular spread around `angle`, radians (default 2π = all directions). */
  spread?: number;
  /** Initial speed, px/step (default `[0.7, 2]`). */
  speed?: Range;
  /** Radius, px (default `[2, 4]`). */
  size?: Range;
  /** Lifetime, ms (default 600). */
  life?: Range;
  /** Downward acceleration, px/step² (default 0). */
  gravity?: number;
  /** Fill color(s); one is picked per particle (default `"#fff"`). */
  color?: string | string[];
}

/** Options for immediate-mode `emit` — call it EVERY step the effect should
 *  burn (from inside your `ecs.each` — the loop IS the attachment); `chance`
 *  gates stateless probabilistic emission. */
export interface EmitOptions extends Omit<BurstOptions, "count"> {
  /** Probability 0..1 of emitting one particle this call (default 1). */
  chance?: number;
}

/** A particle system: emit with `burst`/`emit`, render via
 *  `Draw.particles(sys)`. Simulation is pull-derived from the clock. */
export interface ParticleSystem {
  burst(opts: BurstOptions): void;
  emit(opts: EmitOptions): void;
  /** Remove all particles (round reset). */
  clear(): void;
  /** Live particle count. */
  readonly count: number;
  /** Renderer channel — call `Draw.particles(sys)` instead of this. */
  render(ctx: CanvasRenderingContext2D): void;
}

export interface ParticleOptions {
  /** The time this system lives in. Default `Clock.game` (freezes on hold). */
  clock?: ClockHandle;
  /** Random source — injectable for tests. */
  rng?: () => number;
}

function sample(r: Range, rng: () => number): number {
  return typeof r === "number" ? r : r[0] + rng() * (r[1] - r[0]);
}

// Pre-baked circle per color: a drawImage blit is much cheaper than a
// beginPath/arc/fill per particle, and it carries its color (no fillStyle
// churn).
const DOT_R = 16;
const dotCache = new Map<string, HTMLCanvasElement | null>();

function dotFor(color: string): HTMLCanvasElement | null {
  let dot = dotCache.get(color);
  if (dot === undefined) {
    dot = null;
    try {
      const c = document.createElement("canvas");
      c.width = c.height = DOT_R * 2;
      const g = c.getContext("2d");
      if (g) {
        g.fillStyle = color;
        g.beginPath();
        g.arc(DOT_R, DOT_R, DOT_R, 0, Math.PI * 2);
        g.fill();
        dot = c;
      }
    } catch {
      dot = null; // no canvas support (tests) — fall back to path fills
    }
    dotCache.set(color, dot);
  }
  return dot;
}

const STEP_MS = 1000 / 60;
const MAX_FOLD_STEPS = 240;

function create(options: ParticleOptions = {}): ParticleSystem {
  const rng = options.rng ?? Math.random;
  const clock = options.clock ?? Clock.game;
  const live: Particle[] = [];
  const pool: Particle[] = []; // dead particles, reused by the next burst
  let lastMs = clock.now;

  /** Fold the simulation forward by the clock time elapsed since last read. */
  function fold(): void {
    const now = clock.now;
    let steps = Math.floor((now - lastMs) / STEP_MS);
    if (steps <= 0) return;
    lastMs += steps * STEP_MS;
    if (steps > MAX_FOLD_STEPS) steps = MAX_FOLD_STEPS; // long-idle: all dead anyway
    while (steps-- > 0) {
      for (let i = live.length - 1; i >= 0; i--) {
        const p = live[i];
        p.age += STEP_MS;
        if (p.age >= p.life) {
          const last = live.pop()!;
          if (i < live.length) live[i] = last;
          pool.push(p);
          continue;
        }
        p.vy += p.gravity;
        p.x += p.vx;
        p.y += p.vy;
      }
    }
  }

  function spawnOne(opts: BurstOptions): void {
    const angle = opts.angle ?? 0;
    const spread = opts.spread ?? Math.PI * 2;
    const speed = opts.speed ?? [0.7, 2];
    const size = opts.size ?? [2, 4];
    const life = opts.life ?? 600;
    const gravity = opts.gravity ?? 0;
    const color = opts.color ?? "#fff";

    const dir = angle + (rng() - 0.5) * spread;
    const spd = sample(speed, rng);
    const p = pool.pop() ?? ({} as Particle);
    p.x = opts.at.x;
    p.y = opts.at.y;
    p.vx = Math.cos(dir) * spd;
    p.vy = Math.sin(dir) * spd;
    p.age = 0;
    p.life = sample(life, rng);
    p.size = sample(size, rng);
    p.color = typeof color === "string" ? color : color[(rng() * color.length) | 0];
    p.gravity = gravity;
    live.push(p);
  }

  return {
    burst(opts) {
      fold(); // fresh particles must not inherit backlog aging
      const count = opts.count ?? 12;
      for (let i = 0; i < count; i++) spawnOne(opts);
    },

    emit(opts) {
      fold();
      if (rng() < (opts.chance ?? 1)) spawnOne(opts);
    },

    render(ctx) {
      fold();
      for (const p of live) {
        ctx.globalAlpha = Math.max(0, 1 - p.age / p.life);
        const dot = dotFor(p.color);
        if (dot) {
          ctx.drawImage(dot, p.x - p.size, p.y - p.size, p.size * 2, p.size * 2);
        } else {
          ctx.fillStyle = p.color;
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      ctx.globalAlpha = 1;
    },

    clear() {
      live.length = 0;
    },

    get count() {
      fold();
      return live.length;
    },
  };
}

/** Particle systems are created, never ambient: `Particles.create()`. */
export const Particles = { create };
