// Minimotor - minimal game engine for small 2D canvas games.
// The whole engine is reached through PascalCase `Minimotor.*` namespaces.
// Engine runtime: Stage / Loop / Draw / Keys / Pointer / Mouse (backed by one default
// game built via Stage.init). Services & helpers: Audio, Sprites, Storage, etc.
// `createGame` is exported for isolated instances (tests / multiple games).

import { createGame, Stage, Loop, Draw, Keys, Pointer, Mouse } from "./engine.js";
import {
  rectsOverlap,
  circleHit,
  crossedDown,
  pointInRect,
  sweptAABB,
  circleRect,
  separateCircles,
  bounceInBounds,
} from "./collision.js";
import * as UI from "./ui.js";
import { Particles } from "./particles.js";
import { Scenes } from "./scenes.js";
import { Clock, Tween } from "./clock.js";
import { Signals } from "./signals.js";
import { Assets } from "./assets.js";
import * as ECS from "./ecs.js";
import * as Anim from "./anim.js";
import * as Fsm from "./fsm.js";
import * as Timers from "./timers.js";
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
import * as Goodies from "./goodies.js";
import * as Fullscreen from "./fullscreen.js";
import * as Text from "./text.js";
import * as Tiles from "./tiles.js";
import * as Transitions from "./transitions.js";

export {
  createGame,
  Stage,
  Loop,
  Draw,
  Keys,
  Pointer,
  Mouse,
  Audio,
  Input,
  Storage,
  Physics,
  Sprites,
  Net,
  Perf,
  Camera,
  Game,
  Goodies,
  Fullscreen,
  Text,
  Tiles,
  Transitions,
  Mathf,
  Scenes,
  ECS,
  Clock,
  Tween,
  Signals,
  Assets,
  Anim,
  Fsm,
  Timers,
  Particles,
};
export type {
  Rect,
  Viewport,
  EnginePlugin,
  FrameTimings,
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
export type {
  Animation,
  AnimationStates,
  SheetConfig,
  FrameRect,
  AnimDrawOptions,
} from "./anim.js";
export type { Sweep, Contact, BounceFaces } from "./collision.js";
export type { ShakeState } from "./camera.js";
export type { ParticleSystem, BurstOptions, Range } from "./particles.js";
export type {
  PerfStats,
  PerfTracker,
  NetStats,
  NetMeter,
  PerfHudOptions,
  PerfOptions,
  Sparkline,
} from "./perf.js";
export type { GamepadState } from "./input.js";
export type { State, AnimBridge, FsmOptions, Machine } from "./fsm.js";
export type { Window, Buffer, Cooldown, JumpGate, JumpGateOptions } from "./timers.js";
export type { TileMap, TilesConfig, MoveOptions, MoveResult, MoveDir } from "./tiles.js";
export type { Transition, TransitionRender, TransitionRun } from "./transitions.js";

// A shared default world (`Minimotor.World`) for the common single-world case;
// games that need isolation or per-scene worlds call `ECS.world()` for their own.
const defaultWorld = ECS.world();
export type {
  SfxBuilder,
  MusicConfig,
  Bus,
  Filter,
  Effect,
  DelayEffect,
  ToneOptions,
  ToneSweep,
} from "./audio.js";
export type { PhysicsBody } from "./physics.js";
export type { SpriteCanvas, SheetOptions } from "./sprites.js";
export type {
  Weighted,
  ShuffleBag,
  GridPoint,
  GridNeighborOptions,
  LeadTarget,
  TimingGrade,
  CheckpointRoute,
  DamageRoll,
  ItemStack,
  WaveScale,
  DayPhase,
  DistanceField,
  Combo,
  Charges,
  Flash,
  Patrol,
  Trail,
  Beat,
  UndoStack,
} from "./goodies.js";
export type {
  Transport,
  WsConfig,
  RtcConfig,
  Signal,
  Interpolator,
  InterpolatorOptions,
  Roster,
  RosterOptions,
} from "./net.js";

const Collision = {
  rectsOverlap,
  circleHit,
  crossedDown,
  pointInRect,
  sweptAABB,
  circleRect,
  separateCircles,
  bounceInBounds,
};
export {
  Collision,
  rectsOverlap,
  circleHit,
  crossedDown,
  pointInRect,
  sweptAABB,
  circleRect,
  separateCircles,
  bounceInBounds,
};
export { UI };
export type {
  BarStyle,
  ButtonOptions,
  ButtonStyle,
  ButtonVariant,
  ConfirmOptions,
  DialogOptions,
  DragSourceOptions,
  DragSourceState,
  DraggedItem,
  DropResult,
  DropTargetOptions,
  DropTargetState,
  FloatManager,
  FloatOptions,
  GridOptions,
  GroupOptions,
  IdPart,
  LayoutChildren,
  LayoutOptions,
  ListOptions,
  ListItemOptions,
  ModalOptions,
  PanelOptions,
  PopoverOptions,
  ScrollbarOptions,
  SliderOptions,
  SpinnerOptions,
  Stack,
  StackOptions,
  TabsOptions,
  TextOptions,
  TextInputOptions,
  TextInputResult,
  SelectOption,
  SelectOptions,
  SelectResult,
  Theme,
  ToggleOptions,
} from "./ui.js";

export const Minimotor = {
  createGame,
  Stage,
  Loop,
  Draw,
  Keys,
  Pointer,
  Mouse,
  Audio,
  Input,
  Storage,
  Physics,
  Sprites,
  Net,
  Perf,
  Camera,
  Game,
  Goodies,
  Fullscreen,
  Text,
  Tiles,
  Transitions,
  Mathf,
  Scenes,
  ECS,
  World: defaultWorld,
  Clock,
  Tween,
  Signals,
  Assets,
  Anim,
  Fsm,
  Timers,
  Particles,
  Collision,
  UI,
};

export default Minimotor;
