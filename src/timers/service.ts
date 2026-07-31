// ---------- Timers ----------
// Polled timing latches read as booleans, derived from a `Clock` — they default
// to the app's world clock, so pause and slow-mo affect them. `Timers.window`
// (coyote grace), `Timers.buffer` (early press buffering), `Timers.cooldown`
// (reuse gate), and `Timers.jumpGate` (the first two composed into
// forgiving-jump timing).

import * as TimersModule from "./index.js";
import { withClock } from "../clock.js";
import type { App } from "../engine/app.js";

/** Every timer helper, with the clock argument already answered. */
export type TimersApi = typeof TimersModule;

/** Timer helpers defaulting to one app's world clock. Each call runs inside
 *  `withClock`, and the latches capture that clock as they are built. */
export function createTimers(app: App): TimersApi {
  const clock = app.Clock.world;
  const api: Record<PropertyKey, unknown> = {};
  for (const key of Reflect.ownKeys(TimersModule)) {
    const value = Reflect.get(TimersModule, key);
    api[key] =
      typeof value === "function"
        ? (...args: unknown[]) => withClock(clock, () => value(...args))
        : value;
  }
  return api as TimersApi;
}
