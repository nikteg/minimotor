// Minimotor - minimal game engine for small 2D canvas games.
// All functionality is gathered under a single Minimotor object;
// individual exports are also available for selective imports.

import { Engine, rectsOverlap } from "./engine.js";
import * as Audio from "./audio.js";

export { Engine, Audio };
export type { Rect, EngineShape } from "./engine.js";
export type { SfxBuilder, MusicConfig } from "./audio.js";

const Collision = { rectsOverlap };
export { Collision };

export const Minimotor = {
  Engine,
  Audio,
  Collision,
};

export default Minimotor;
