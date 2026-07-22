// Minimotor - minimal game engine for small 2D canvas games.
// The whole engine is reached through PascalCase `Minimotor.*` namespaces.
// Engine runtime: Stage / Loop / Draw / Keys / Pointer / Mouse (backed by one default
// game built via Stage.init). Services & helpers: Audio, Sprites, Storage, etc.
// `createGame` is exported for isolated instances (tests / multiple games).

import { createGame, Stage, Loop, Draw, Keys, Pointer, Mouse } from "./engine/index.js";
import { Vec2 } from "./vec2.js";
import {
  rectsOverlap,
  circleHit,
  crossedDown,
  pointInRect,
  sweptAABB,
  circleRect,
  separateCircles,
  bounceInBounds,
  slide,
  moveAndSlide,
} from "./collision.js";
import * as UI from "./ui/index.js";
import { Particles } from "./particles.js";
import { Scenes } from "./scenes.js";
import { Clock } from "./clock.js";
import { Signals } from "./signals.js";
import { Assets } from "./assets.js";
import * as ECS from "./ecs/index.js";
import * as Anim from "./anim/index.js";
import * as Fsm from "./fsm.js";
import * as Timers from "./timers.js";
import * as Audio from "./audio/index.js";
import * as Mathf from "./mathf.js";
import * as Input from "./input/index.js";
import * as Storage from "./storage.js";
import * as Sprites from "./sprites.js";
import * as Net from "./net/index.js";
import * as Perf from "./perf/index.js";
import { Camera, createCamera } from "./camera/index.js";
import * as Game from "./game.js";
import * as Goodies from "./goodies/index.js";
import * as Gizmos from "./gizmos/index.js";
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
  Sprites,
  Net,
  Perf,
  Camera,
  createCamera,
  Game,
  Goodies,
  Gizmos,
  Tiles,
  Transitions,
  Mathf,
  Scenes,
  ECS,
  Clock,
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
  KeyCode,
  EnginePlugin,
  FrameTimings,
  GameCallbacks,
  Game as GameHost,
  GameOptions,
  StageOptions,
  DrawTextOptions,
  DrawSpriteOptions,
  SpriteLike,
  ParticleLike,
  TilesLike,
} from "./engine/index.js";
export type { Scene, SceneManager } from "./scenes.js";
export type {
  Component,
  ComponentInit,
  Entity,
  Ecs,
  System,
  RenderSystem,
  SpriteData,
  DrawSpritesOptions,
} from "./ecs/index.js";
export type { ClockHandle, Cancel } from "./clock.js";
export type { SignalBus } from "./signals.js";
export type {
  AssetStore,
  AssetManifest,
  AssetSpec,
  ProgressFn,
  Loaded,
  LoadedAsset,
} from "./assets.js";
export type {
  Sheet,
  SheetCursor,
  SheetOptions,
  SheetStateSpec,
  SheetImage,
  FrameRect,
  Motion,
  AnimateOptions,
  SequenceStep,
  Parallel,
} from "./anim/index.js";
export type {
  Sweep,
  Contact,
  BounceFaces,
  Solid,
  SolidSource,
  Solids,
  Contacts,
  MoverBody,
} from "./collision.js";
export type { CameraOptions, CameraLens, RenderOptions, FollowTarget } from "./camera/index.js";
export type {
  ParticleSystem,
  BurstOptions,
  EmitOptions,
  ParticleOptions,
  Range,
} from "./particles.js";
export type {
  PerfStats,
  PerfTracker,
  NetStats,
  NetMeter,
  PerfHudOptions,
  PerfOptions,
  Sparkline,
} from "./perf/index.js";
export type {
  GamepadState,
  PadButton,
  PadCode,
  Binding,
  ActionState,
  InputMap,
  InputMapOptions,
} from "./input/index.js";
export type { State, FsmOptions, Machine } from "./fsm.js";
export type { Window, Buffer, Cooldown, JumpGate, JumpGateOptions } from "./timers.js";
export type {
  Level,
  GridOptions as TileGridOptions,
  TileSpec,
  Cell,
  Selector,
  SelectorCell,
  Skin,
  SkinValue,
  TileSet,
  TileSetOptions,
} from "./tiles.js";
export type { Transition, TransitionRender, TransitionRun } from "./transitions.js";

export type {
  SfxBuilder,
  MusicConfig,
  Bus,
  Filter,
  Effect,
  DelayEffect,
  ToneOptions,
  ToneSweep,
} from "./audio/index.js";
export type { SpriteCanvas, AtlasOptions } from "./sprites.js";
export type {
  Weighted,
  GridPoint,
  GridNeighborOptions,
  LeadTarget,
  TimingGrade,
  DamageRoll,
  ItemStack,
  WaveScale,
  DayPhase,
  DistanceField,
  Beat,
} from "./goodies/index.js";
export type {
  ShuffleBag,
  CheckpointRoute,
  Combo,
  Charges,
  Flash,
  Patrol,
  Trail,
  UndoStack,
  Car,
  CarConfig,
  DriveInput,
  DrivableBody,
} from "./gizmos/index.js";
export type {
  Transport,
  WsConfig,
  RtcConfig,
  Signal,
  RtcSessionOptions,
  HostSession,
  GuestSession,
  Interpolator,
  InterpolatorOptions,
  Roster,
  RosterOptions,
} from "./net/index.js";

const Collision = {
  rectsOverlap,
  slide,
  moveAndSlide,
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
  slide,
  moveAndSlide,
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
  TableColumn,
  TableSort,
  TableOptions,
  TableResult,
  TabsOptions,
  TextOptions,
  TextInputOptions,
  TextInputResult,
  SelectOption,
  SelectOptions,
  SelectResult,
  Theme,
  ToggleOptions,
} from "./ui/index.js";

export { Vec2 } from "./vec2.js";

export const Minimotor = {
  createGame,
  Stage,
  Vec2,
  Loop,
  Draw,
  Keys,
  Pointer,
  Mouse,
  Audio,
  Input,
  Storage,
  Sprites,
  Net,
  Perf,
  Camera,
  Game,
  Goodies,
  Gizmos,
  Tiles,
  Transitions,
  Mathf,
  Scenes,
  ECS,
  Clock,
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
