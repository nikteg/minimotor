import {
  createOnscreenGamepad,
  destroyOnscreenGamepad,
  drawControls,
  visible,
  type OnscreenGamepadConfig,
  type OnscreenPad,
} from "../../onscreen.js";
import type { InputApi } from "../input/index.js";
import type { Game } from "../../engine/app.js";

export interface OnscreenInputApi {
  gamepad(config?: OnscreenGamepadConfig): OnscreenPad;
  drawControls(pad: OnscreenPad): void;
  visible(pad: OnscreenPad): boolean;
  destroy(): void;
}

/** Create virtual controls bound explicitly to one game and input instance. */
export function createOnscreenInput(game: Game, input: InputApi): OnscreenInputApi {
  const pads = new Set<OnscreenPad>();
  let destroyed = false;
  const destroy = () => {
    if (destroyed) return;
    destroyed = true;
    for (const pad of pads) destroyOnscreenGamepad(pad);
    pads.clear();
  };
  const api: OnscreenInputApi = {
    gamepad(config) {
      const pad = createOnscreenGamepad(
        {
          canvas: game.canvas,
          ctx: game.ctx,
          viewport: game.viewport,
          onStepStart: game.Loop.onStepStart,
          onFrame: game.Loop.onFrame,
          registerGamepad: input.registerGamepad,
        },
        config,
      );
      pads.add(pad);
      return pad;
    },
    drawControls,
    visible,
    destroy,
  };
  game.use({ name: "OnscreenInput", onDestroy: destroy });
  return api;
}

export type { OnscreenGamepadConfig, OnscreenPad };
