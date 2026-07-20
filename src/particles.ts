// ---------- Particles ----------
// A tiny CPU particle system for impact/juice — death bursts, coin sparkles,
// dust. Particles are short-lived colored dots with velocity, optional gravity
// and a fade-out. Deliberately simpler than the ECS: a flat pooled array, no
// components — high churn, no queries, so plain data wins.
//
//   Minimotor.Particles.burst(x, y, { count: 24, speed: [60, 240], gravity: 400 });
//   // in your draw():  Minimotor.Particles.draw(ctx);
//
// The default `Particles` ages on the loop's fixed step (pauses with the loop,
// frame-rate independent). Velocities are px/second, gravity px/second², life
// in ms.

import { Loop } from "./engine.js";

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

/** A `number` (fixed) or an inclusive `[min, max]` range to sample from. */
export type Range = number | [number, number];

/** Options for a `burst`. All optional — defaults give a small round puff. */
export interface BurstOptions {
  /** How many particles to emit (default 12). */
  count?: number;
  /** Emission direction in radians (default 0 = +x). */
  angle?: number;
  /** Angular spread around `angle`, radians (default 2π = all directions). */
  spread?: number;
  /** Initial speed, px/s (default `[40, 120]`). */
  speed?: Range;
  /** Radius, px (default `[2, 4]`). */
  size?: Range;
  /** Lifetime, ms (default 600). */
  life?: Range;
  /** Downward acceleration, px/s² (default 0). */
  gravity?: number;
  /** Fill color(s); one is picked per particle (default `"#fff"`). */
  colors?: string | string[];
}

/** A particle system: emit with `burst`, age with `advance(dt)`, render with
 *  `draw(ctx)`. */
export interface ParticleSystem {
  burst(x: number, y: number, opts?: BurstOptions): void;
  /** Advance every particle by `dt` ms and cull the dead. */
  advance(dt: number): void;
  /** Draw every particle as a faded filled circle. */
  draw(ctx: CanvasRenderingContext2D): void;
  /** Remove all particles. */
  clear(): void;
  /** Live particle count. */
  readonly count: number;
}

function sample(r: Range, rng: () => number): number {
  return typeof r === "number" ? r : r[0] + rng() * (r[1] - r[0]);
}

/** Create an independent particle system. Pure (drive `advance` yourself); the
 *  default `Particles` wires one to the loop's fixed step. `rng` is injectable
 *  for tests. */
export function createParticles(rng: () => number = Math.random): ParticleSystem {
  const live: Particle[] = [];

  return {
    burst(x, y, opts = {}) {
      const count = opts.count ?? 12;
      const angle = opts.angle ?? 0;
      const spread = opts.spread ?? Math.PI * 2;
      const speed = opts.speed ?? [40, 120];
      const size = opts.size ?? [2, 4];
      const life = opts.life ?? 600;
      const gravity = opts.gravity ?? 0;
      const colors = opts.colors ?? "#fff";

      for (let i = 0; i < count; i++) {
        const dir = angle + (rng() - 0.5) * spread;
        const spd = sample(speed, rng);
        live.push({
          x,
          y,
          vx: Math.cos(dir) * spd,
          vy: Math.sin(dir) * spd,
          age: 0,
          life: sample(life, rng),
          size: sample(size, rng),
          color: typeof colors === "string" ? colors : colors[(rng() * colors.length) | 0],
          gravity,
        });
      }
    },

    advance(dt) {
      const s = dt / 1000;
      // Iterate backwards so swap-remove of dead particles is safe.
      for (let i = live.length - 1; i >= 0; i--) {
        const p = live[i];
        p.age += dt;
        if (p.age >= p.life) {
          const last = live.pop()!;
          if (i < live.length) live[i] = last;
          continue;
        }
        p.vy += p.gravity * s;
        p.x += p.vx * s;
        p.y += p.vy * s;
      }
    },

    draw(ctx) {
      for (const p of live) {
        ctx.globalAlpha = Math.max(0, 1 - p.age / p.life);
        ctx.fillStyle = p.color;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
    },

    clear() {
      live.length = 0;
    },

    get count() {
      return live.length;
    },
  };
}

// ---------- Default facade (aged on the loop's fixed step) ----------

let sys = createParticles();
let wired = false;

function ensureWired(): void {
  if (wired) return;
  wired = true;
  Loop.onStep(() => sys.advance(Loop.step));
}

/** The default particle system, driven by the loop. */
export const Particles = {
  /** Emit a burst of particles at (x, y). See `BurstOptions`. */
  burst(x: number, y: number, opts?: BurstOptions): void {
    ensureWired();
    sys.burst(x, y, opts);
  },
  /** Draw all live particles — call from your scene `draw`. */
  draw(ctx: CanvasRenderingContext2D): void {
    sys.draw(ctx);
  },
  /** Remove all particles (e.g. on round reset). */
  clear(): void {
    sys.clear();
  },
  /** Live particle count. */
  get count(): number {
    return sys.count;
  },
  /** Reset the system and loop wiring — for tests. */
  _reset(): void {
    sys = createParticles();
    wired = false;
  },
};
