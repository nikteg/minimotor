// Minimotor - minimal game engine for small 2D canvas games.
// The whole engine is reached through PascalCase `Minimotor.*` namespaces.
// Engine runtime: Stage / Loop / Draw / Keys / Pointer (backed by one default
// game built via Stage.init). Services & helpers: Audio, Sprites, Storage, etc.
// `createGame` is exported for isolated instances (tests / multiple games).

import { createGame, Stage, Loop, Draw, Keys, Pointer } from "./engine.js";
import { rectsOverlap, circleHit, crossedDown, sweptAABB } from "./collision.js";
import { Particles } from "./particles.js";
import { Scenes } from "./scenes.js";
import { Clock, Tween } from "./clock.js";
import { Signals } from "./signals.js";
import { Assets } from "./assets.js";
import * as ECS from "./ecs.js";
import * as Anim from "./anim.js";
import * as Audio from "./audio.js";
import * as Mathf from "./mathf.js";
import * as Input from "./input.js";
import * as Storage from "./storage.js";
import * as Physics from "./physics.js";
import * as Sprites from "./sprites.js";
import * as Net from "./net.js";
import * as Perf from "./perf.js";
import * as Camera from "./camera.js";
import * as Game from "./game.js";
import * as Fullscreen from "./fullscreen.js";
import * as Text from "./text.js";
import * as Tiles from "./tiles.js";

export {
  createGame,
  Stage,
  Loop,
  Draw,
  Keys,
  Pointer,
  Audio,
  Input,
  Storage,
  Physics,
  Sprites,
  Net,
  Perf,
  Camera,
  Game,
  Fullscreen,
  Text,
  Tiles,
  Mathf,
  Scenes,
  ECS,
  Clock,
  Tween,
  Signals,
  Assets,
  Anim,
  Particles,
};
export type {
  Rect,
  Viewport,
  EnginePlugin,
  GameCallbacks,
  Game as GameHost,
  GameBuilder,
  GameOptions,
  StageOptions,
} from "./engine.js";
export type { Scene, SceneManager } from "./scenes.js";
export type {
  Component,
  ComponentInit,
  Entity,
  World,
  System,
  RenderSystem,
  SpriteData,
  DrawSpritesOptions,
} from "./ecs.js";
export type { ClockManager, Cancel } from "./clock.js";
export type { SignalBus } from "./signals.js";
export type { AssetStore, AssetManifest, ProgressFn } from "./assets.js";
export type { Animation, SheetConfig, FrameRect, AnimDrawOptions } from "./anim.js";
export type { Sweep } from "./collision.js";
export type { ShakeState } from "./camera.js";
export type { ParticleSystem, BurstOptions, Range } from "./particles.js";
export type {
  PerfStats,
  PerfTracker,
  NetStats,
  NetMeter,
  PerfHudOptions,
  PerfOptions,
} from "./perf.js";
export type { GamepadState } from "./input.js";
export type { TileMap, TilesConfig } from "./tiles.js";

// A shared default world (`Minimotor.World`) for the common single-world case;
// games that need isolation or per-scene worlds call `ECS.world()` for their own.
const defaultWorld = ECS.world();
export type { SfxBuilder, MusicConfig } from "./audio.js";
export type { PhysicsBody } from "./physics.js";
export type { SpriteCanvas } from "./sprites.js";
export type {
  Transport,
  WsConfig,
  RtcConfig,
  Signal,
  Interpolator,
  InterpolatorOptions,
} from "./net.js";

const Collision = { rectsOverlap, circleHit, crossedDown, sweptAABB };
export { Collision, rectsOverlap, circleHit, crossedDown, sweptAABB };

export const Minimotor = {
  createGame,
  Stage,
  Loop,
  Draw,
  Keys,
  Pointer,
  Audio,
  Input,
  Storage,
  Physics,
  Sprites,
  Net,
  Perf,
  Camera,
  Game,
  Fullscreen,
  Text,
  Tiles,
  Mathf,
  Scenes,
  ECS,
  World: defaultWorld,
  Clock,
  Tween,
  Signals,
  Assets,
  Anim,
  Particles,
  Collision,
};

export default Minimotor;
