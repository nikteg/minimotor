// Minimotor — a minimal 2D canvas framework for small games and playful apps.
// createApp creates isolated apps.
//
// WHERE A CAPABILITY LIVES
//
// A capability gets its own SUBPATH (`minimotor/audio`, `minimotor/ui`,
// `minimotor/procgen`, ...) when either is true:
//
//   BOUND TO AN APP — it is created with `create*(app)` and owns per-app state
//   and lifecycle. Every one of these is subpath-only, with no exceptions:
//   animation, assets, audio, autosave, camera, capture, debug, input, net,
//   onscreen-input, particles, performance, physics2d, physics3d, portals, scenes,
//   storage, timers, ui.
//
//   USEFUL WITHOUT A CANVAS — it is pure, but you would reasonably import it
//   ALONE, from a server, a test or the `mm` CLI, without pulling in the
//   engine: procgen, ecs, ldtk, aseprite, platformer, rng, snapshots, sprites,
//   hot-reload.
//
// THIS FILE is what is left: pure namespaces you use *alongside* the canvas
// and would never import on their own — `Collision`, `Tiles`, `Font`,
// `Goodies`/`Gizmos` (the pure/stateful pair), `Fsm`, `Transitions`, `Mathf`,
// `Vec2`. They ride along with `createApp` because that is where they are used.
//
// ONE NAME, ONE HOME. A capability appears in exactly one of those places.
// `Sprites` and `HotReload` used to be in two, and `Sprites` was the worse case: the
// root re-exported `./sprites/core.js` while the subpath exported core + ECS,
// so `Sprites.Sprite` existed through `minimotor/sprites` and not through
// `minimotor` — while the doc comment here promised it either way. Both now
// live at their subpath only.

import { createApp } from "./engine/index.js";
import * as Collision from "./collision/index.js";
/** General finite state machine: `Fsm.create(states, initial)` builds a machine
 *  of named states with `enter`/`update`/`exit`. `machine.update()` runs the
 *  active state and transitions on the name it returns; `machine.go(name)`
 *  forces one. Drives per-entity behavior (idle/run/jump, AI) and anim states. */
import * as Fsm from "./fsm/index.js";
/** Small math helpers (named à la Unity so it never shadows `Math`):
 *  interpolation (`Mathf.lerp`, `Mathf.damp`, `Mathf.approach`), ranges
 *  (`Mathf.clamp`, `Mathf.remap`), oscillators (`Mathf.pingPong`, `Mathf.wave`),
 *  plus randomness and 0..1 easing curves. */
import * as Mathf from "./math/mathf.js";
/** Pure, dependency-free game recipes (call one, get a value) that recur across
 *  genres: `Goodies.leadTarget`/`Goodies.nearest` (steering), `Goodies.floodFill`/
 *  `Goodies.lineOfSight` (grid), `Goodies.weightedPick`/`Goodies.rollDice`
 *  (random), `Goodies.wrap` (toroidal), `Goodies.formatClock` (HUD readout).
 *  Stateful gadgets live in `Gizmos`. */
import * as Goodies from "./goodies/index.js";
/** Stateful game gadgets you create once then tick/mutate (the sibling of
 *  `Goodies`): `Gizmos.combo`, `Gizmos.scoreTracker`, `Gizmos.patrol`,
 *  `Gizmos.trail`, `Gizmos.charges`, `Gizmos.checkpointRoute`,
 *  `Gizmos.seedRng`/`Gizmos.shuffleBag`, `Gizmos.undoStack`, and
 *  `Gizmos.car`/`Gizmos.skidmarks`. */
import * as Gizmos from "./gizmos/index.js";
/** ASCII and Tiled levels as pure data: `Tiles.grid` and `Tiles.Tiled.grid`
 *  build the same queryable `SolidSource` `Level` (feed
 *  it to `Collision.moveAndSlide`). `Tiles.Tiled.set(image, tsj)` reads atlas
 *  names, regions, animations, and Wang terrain directly from Tiled JSON.
 *  `Tiles.world` gives
 *  ordinary string maps the same multi-level portal/transition contract.
 *  `span` lets one map char own a multi-cell collision shape. `Tiles.set`
 *  slices a tileset image into cells/regions plus `pick`/`anim`/`auto9`/`auto16`
 *  selectors, joined to a level by a `Skin` at `Draw.tiles`. `auto4` autotiles
 *  from a 16-cell DUAL grid instead of a 47-cell blob set, `orient` mirrors and
 *  turns a cell at draw time, and `recolor` palette-swaps a whole tileset.
 *
 *    const level = Tiles.grid("R.######\\n#..P...#", {
 *      size: 16,
 *      legend: {
 *        "#": { solid: true },
 *        R: { slope: "up-right", span: [2, 1] },
 *      },
 *    });
 *    const tiles = Tiles.set(terrainImage, { size: 16, names: { ground: [0, 0] } });
 *    const skin = { "#": tiles.ground, R: tiles.region(4, 2, 2, 2) };
 *    const start = level.spawnOne("P");
 */
import * as Tiles from "./tiles/index.js";
/** Text drawn from a sprite atlas instead of a typeface. `Font.atlas(sheet,
 *  { cell: 8 })` slices a pixel-font sheet into glyphs — trimmed to their ink,
 *  so the result is proportional rather than gappy — and `Font.glyphs` names
 *  arbitrary rects for sheets that are not a grid. Pass the result to
 *  `Draw.text` as `font`; `color` tints it and `scale` upscales it exactly.
 *
 *    const font = Font.atlas(sheet, { cell: 8, chars: Font.ASCII, cols: 16 });
 *    Draw.text("READY", { x: 20, y: 20, font, color: "#ffd43b", scale: 3 });
 */
import * as Font from "./font/index.js";
/** Cover → swap → reveal scene transitions passed to `Scenes.go`. `Transitions.fade`
 *  and `Transitions.wipe` are ready-made; a `Transition` is plain data, and the
 *  pure fixed-step runner `Transitions.run` fires the swap at full coverage. */
import * as Transitions from "./transitions/index.js";

export { createApp, Goodies, Gizmos, Tiles, Font, Transitions, Mathf, Fsm };
export type {
  BitmapFont,
  BitmapTextStyle,
  FontAtlasOptions,
  FontGlyphsOptions,
  FontImage,
  FontOptions,
  Glyph,
} from "./font/index.js";
/** One isolated app, as returned by `createApp`. This is the type every
 *  lifecycle-owned factory takes: `createAudio(app)`, `createUI(app)`,
 *  `createNet(app)` — so it's also the type to annotate your own helpers with.
 *
 *    function spawnHud(app: App) { ... }
 */
export type { App } from "./engine/index.js";
export type {
  PlatformerAnimationState,
  PlatformerAnimationBody,
  PlatformerAnimationCursor,
  PlatformerAnimations,
} from "./platformer/index.js";
export type {
  Anchor,
  StickSpec,
  ButtonSpec,
  HapticsConfig,
  OnscreenGamepadConfig,
  OnscreenPad,
} from "./onscreen/index.js";
export type {
  Rect,
  Viewport,
  KeyCode,
  // The per-app services an `App` hands out. A game that wires its app up in
  // one module and re-exports the bound services needs to NAME these, or the
  // re-export infers a type that can't be written down outside node_modules.
  Keys,
  Pointer,
  SecondaryButton,
  LoopApi,
  FrameTimings,
  AppCallbacks,
  AppOptions,
  DrawApi,
  DrawTextOptions,
  FontLike,
  DrawSpriteOptions,
  DrawSprite,
  DrawSpritesOptions,
  DrawTilesOptions,
  SpriteLike,
  ParticleLike,
  TilesLike,
  Fill,
  GradientStops,
} from "./engine/index.js";
export type { SceneSpec, SceneStack, GoOptions, SceneStackOptions } from "./scenes/index.js";
export type {
  Portal,
  PortalArea,
  PortalBody,
  PortalDestination,
  PortalOptions,
  PortalRouter,
  PortalTravel,
} from "./portals/index.js";
export type { ClockApi, ClockHandle, Cancel } from "./clock/index.js";
export type { SignalBus } from "./signals/index.js";
export { createSignals } from "./signals/index.js";
export type {
  AssetStore,
  AssetManifest,
  AssetSpec,
  ProgressFn,
  Loaded,
  LoadedAsset,
} from "./assets/index.js";
export type {
  GridAnimationSource,
  AnimationSource,
  AnimationCursor,
  SheetOptions,
  SheetStateSpec,
  SheetImage,
  FrameRect,
  ImageAnimationSource,
  ImageAnimationCursor,
  StateClip,
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
  SlopeDirection,
  LadderSource,
  Ladders,
  ClimbLadderOptions,
  SolidGrid,
  Contacts,
  MoverBody,
} from "./collision/index.js";
export type {
  CameraOptions,
  CameraLens,
  RenderOptions,
  ScreenMapOptions,
  FollowTarget,
} from "./camera/index.js";
export type {
  ParticleSystem,
  BurstOptions,
  EmitOptions,
  ParticleOptions,
  Range,
} from "./particles/index.js";
export type {
  PerfStats,
  Perf3DSource,
  Perf3DFrameStats,
  Perf3DStats,
  PerfTracker,
  NetStats,
  NetMeter,
  PerfHudOptions,
  PerfOptions,
  Sparkline,
} from "./perf/index.js";
export type {
  GamepadState,
  GamepadNavigation,
  PadButton,
  PadCode,
  Binding,
  ActionState,
  InputMap,
  InputMapOptions,
} from "./input/index.js";
export type { State, FsmOptions, Machine } from "./fsm/index.js";
export type { Window, Buffer, Cooldown, JumpGate, JumpGateOptions } from "./timers/index.js";
export type {
  Level,
  GridOptions as TileGridOptions,
  TileSpec,
  Cell,
  CellOrientation,
  DualLayer,
  Auto4Options,
  Auto9Options,
  Selector,
  SelectorCell,
  Skin,
  SkinValue,
  TileSet,
  TileSetEntry,
  TileSetOptions,
} from "./tiles/index.js";
export type {
  Transition,
  TransitionRender,
  TransitionRun,
  TransitionPhases,
} from "./transitions/index.js";

export type {
  SfxBuilder,
  MusicConfig,
  SfxSpec,
  SfxHandle,
  PlayOptions,
  BusHandle,
  EngineOptions,
  EngineDrive,
  EngineHandle,
  MusicOptions,
  MusicHandle,
  Bus,
  Filter,
  Effect,
  DelayEffect,
  ToneOptions,
  ToneSweep,
} from "./audio/index.js";
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
  CarPresetId,
  DriveInput,
  DrivableBody,
  Skidmarks,
  SkidmarksOptions,
  TraceInput,
  ScoreTracker,
  ScoreStore,
} from "./gizmos/index.js";
export type {
  Transport,
  WsConfig,
  RtcConfig,
  Signal,
  RtcSessionOptions,
  HostSession,
  GuestSession,
  Room,
  RoomOptions,
  SyncOptions,
  PeerStates,
  Interpolator,
  InterpolatorOptions,
  Roster,
  RosterOptions,
  Protocol,
  ProtocolShape,
  StateOf,
  EventsOf,
  RequestsOf,
  ClientMessageOf,
  ServerMessageOf,
  ProtocolTransport,
  SharedItemId,
  SharedItem,
  SharedItemsOptions,
  SharedItems,
  Shared,
  BodyState,
} from "./net/index.js";

/** Pure, allocation-free collision geometry. `Collision.moveAndSlide`/
 *  `Collision.slide` do swept platformer resolution against `Solids`, plus
 *  overlap tests `Collision.rectsOverlap`, `Collision.circleRect`,
 *  `Collision.sweptAABB` and the `Collision.bounceInBounds` wall reflector.
 *
 *    body.vel.y += GRAVITY;
 *    Collision.moveAndSlide(body, level);   // moves body, zeroes blocked axes
 *    climbing = Collision.climbLadder(body, level, input.axis("up", "down"));
 *    if (body.grounded && input.jump.pressed) body.vel.y = -JUMP;
 */
export { Collision };

export type {
  BarOptions,
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
  Fillable,
  FloatTextManager,
  FloatTextOptions,
  Flowable,
  GridOptions,
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
  Flow,
  FlowOptions,
  TableColumn,
  TableSort,
  TableOptions,
  TableResult,
  TabsOptions,
  TextOptions,
  TextInputOptions,
  TextInputResult,
  SelectGroup,
  SelectOption,
  SelectOptions,
  SelectResult,
  Theme,
  ThemeOverrides,
  ThemeButton,
  ThemePanel,
  ThemePanelTitle,
  ThemePadding,
  ResolvedThemePadding,
  ThemeSpacing,
  ThemeTextPadding,
  ThemeButtonText,
  ThemeSelect,
  NineSliceRegion,
  TileRegion,
  TilesetFrameRole,
  TilesetSkin,
  TilesetSkinOptions,
  TilesetSprite,
  TilesetCellSource,
  ToggleOptions,
} from "./ui/api.js";

export { Vec2 } from "./math/vec2.js";

/** 3D math: structural `Vec3`/`Quat` (plain `{x,y,z}` / `{x,y,z,w}` data, same
 *  out-last convention as `Vec2`) and column-major `Mat4`. Right-handed, +Y up,
 *  camera down −Z — the glTF/OpenGL convention, deliberately NOT the 2D
 *  renderer's +Y down. */
export { Vec3 } from "./math/vec3.js";
export { Quat } from "./math/quat.js";
export { Mat4 } from "./math/mat4.js";

/** Page-level styling and gesture guards. `createApp` applies `applyFullscreen`
 *  for you unless you pass `fullscreen: false`; these are the manual handles for
 *  pages that opt out and want to apply the rules themselves, later, or merge
 *  `fullscreenCSS` into their own stylesheet. */
export { applyFullscreen, fullscreenCSS, preventNavigation } from "./engine/fullscreen.js";
