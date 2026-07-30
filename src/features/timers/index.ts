import * as TimersModule from "../../timers.js";
import type { Game } from "../../engine/app.js";

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

/** Timer helpers defaulting to one game's world clock. */
export function createTimers(game: Game): TimersApi {
  return {
    ...TimersModule,
    window(ms, clock = game.Clock.world) {
      return TimersModule.window(ms, clock);
    },
    buffer(ms, clock = game.Clock.world) {
      return TimersModule.buffer(ms, clock);
    },
    cooldown(ms, clock = game.Clock.world) {
      return TimersModule.cooldown(ms, clock);
    },
    jumpGate(options = {}) {
      return TimersModule.jumpGate({ clock: game.Clock.world, ...options });
    },
  };
}
