// ---------- On-screen input ----------
// Opt-in on-screen touch gamepad. `OnscreenInput.gamepad(config)` returns a
// `GamepadState` for `Input.map({ pad })` and `OnscreenInput.drawControls(pad)`
// renders it — touch and a hardware pad share one code path.
// `pad.buttonBounds("a")` locates a semantic canvas button for automation.

import {
  createOnscreenGamepad,
  destroyOnscreenGamepad,
  drawControls,
  visible,
  type OnscreenGamepadConfig,
  type OnscreenPad,
} from "./controls.js";
import type { InputApi } from "@src/input/index.js";
import type { App } from "@src/engine/app.js";
import type { UiApi } from "@src/ui/index.js";

export interface OnscreenInputApi {
  gamepad(config?: OnscreenGamepadConfig): OnscreenPad;
  drawControls(pad: OnscreenPad): void;
  visible(pad: OnscreenPad): boolean;
  destroy(): void;
}

/** Create virtual controls bound explicitly to one app and input instance. */
export function createOnscreenInput(
  app: App,
  input: InputApi,
  ui: Pick<UiApi, "getTheme">,
): OnscreenInputApi {
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
          canvas: app.canvas,
          ctx: app.ctx,
          viewport: app.viewport,
          onStepStart: app.Loop.onStepStart,
          onFrame: app.Loop.onFrame,
          registerGamepad: input.registerGamepad,
          theme: ui.getTheme,
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
  app.onDestroy(destroy);
  return api;
}

export type { OnscreenGamepadConfig, OnscreenPad };

export * from "./controls.js";
