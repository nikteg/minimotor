// ---------- Timers ----------
// Polled timing latches read as booleans, derived from a `Clock` — they default
// to the app's world clock, so pause and slow-mo affect them. `Timers.window`
// (coyote grace), `Timers.buffer` (early press buffering), `Timers.cooldown`
// (reuse gate), and `Timers.jumpGate` (the first two composed into
// forgiving-jump timing).

import * as TimersModule from "../../timers.js";
import type { App } from "../../engine/app.js";

export type TimersApi = Omit<typeof TimersModule, "window" | "buffer" | "cooldown" | "jumpGate"> & {
  window(ms: number, clock?: Parameters<typeof TimersModule.window>[1]): TimersModule.Window;
  buffer(ms: number, clock?: Parameters<typeof TimersModule.buffer>[1]): TimersModule.Buffer;
  cooldown(ms: number, clock?: Parameters<typeof TimersModule.cooldown>[1]): TimersModule.Cooldown;
  jumpGate(
    options?: Omit<TimersModule.JumpGateOptions, "clock"> & {
      clock?: TimersModule.JumpGateOptions["clock"];
    },
  ): TimersModule.JumpGate;
};

/** Timer helpers defaulting to one app's world clock. */
export function createTimers(app: App): TimersApi {
  return {
    ...TimersModule,
    window(ms, clock = app.Clock.world) {
      return TimersModule.window(ms, clock);
    },
    buffer(ms, clock = app.Clock.world) {
      return TimersModule.buffer(ms, clock);
    },
    cooldown(ms, clock = app.Clock.world) {
      return TimersModule.cooldown(ms, clock);
    },
    jumpGate(options = {}) {
      return TimersModule.jumpGate({ clock: app.Clock.world, ...options });
    },
  };
}
