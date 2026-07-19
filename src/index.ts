// Minimotor - minimal game engine for small 2D canvas games.
// All functionality is gathered under a single Minimotor object;
// individual exports are also available for selective imports.

import { Engine, rectsOverlap } from "./engine.js";
import * as Audio from "./audio.js";

export { Engine, rectsOverlap, Audio };
export type { Rect, EngineShape } from "./engine.js";
export type { SfxBuilder, MusicConfig } from "./audio.js";

export const Minimotor = {
  Engine,
  rectsOverlap,
  Audio,
};

export default Minimotor;
