// Minimotor — a minimal 2D canvas framework for small games and playful apps.
// The whole engine is reached through PascalCase `Minimotor.*` namespaces.
// Engine runtime: App / Loop / Draw / Keys / Pointer / Mouse (backed by one default
// app built via App.init). Services & helpers: Audio, Sprites, Storage, etc.
// Isolated app instances (tests / multiple apps) are created with
// `App.create`; extra camera lenses with `Camera.create`.

import { App, Loop, Draw, Keys, Pointer, Mouse } from "./engine/index.js";
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
  dropThrough,
  slopeY,
  climbLadder,
  grid,
  contacts,
} from "./collision.js";
/** Immediate-mode UI: buttons, panels, lists, tables, dialogs, drag-and-drop.
 *  Widgets are drawn and polled every frame from their options — no retained
 *  widget tree, no event handlers to wire up.
 *
 *    if (UI.button("Play", { x: 300, y: 200 })) start();
 *    UI.panel({ x: 20, y: 20, w: 200, h: 120, title: "Inventory" });
 */
import * as UI from "./ui/index.js";
import { Particles } from "./particles.js";
import { Scenes } from "./scenes.js";
import { Clock } from "./clock.js";
import { Signals } from "./signals.js";
import { Assets } from "./assets.js";
/** Tiny archetype-free entity-component-system. `ECS.component` declares a
 *  component and `ECS.create` builds a world; then `world.spawn`,
 *  `world.query`/`world.dense` and `world.system` handle iteration and per-step
 *  logic. Content-agnostic — render via `Sprites.Sprite` + `Draw.sprites`.
 *
 *    const Pos = ECS.component<{ x: number; y: number }>("Pos");
 *    const world = ECS.create();
 *    world.spawn(Pos.with({ x: 0, y: 0 }));
 *    for (const [id, p] of world.query(Pos)) p.x += 1;
 */
import * as ECS from "./ecs/index.js";
/** Frame-based sprite animation: `Anim.sheet` (one strip, many frames),
 *  `Anim.states` (one image per state, switched by key) and composable value
 *  tweens (`Anim.animate`, `Anim.sequence`, `Anim.parallel`). Cursors here are
 *  `Draw.sprite`-ready.
 *
 *    const hero = Anim.sheet(img, {
 *      frame: { w: 32, h: 32 },
 *      states: { idle: { row: 0, frames: 4 }, run: { row: 1, frames: 6, fps: 12 } },
 *    });
 *    const anim = hero.play("idle");   // per-entity cursor
 *    Draw.sprite(anim, player);
 */
import * as Anim from "./anim/index.js";
/** General finite state machine: `Fsm.create(states, initial)` builds a machine
 *  of named states with `enter`/`update`/`exit`. `machine.update()` runs the
 *  active state and transitions on the name it returns; `machine.go(name)`
 *  forces one. Drives per-entity behavior (idle/run/jump, AI) and anim states. */
import * as Fsm from "./fsm.js";
/** Polled timing latches read as booleans, derived from a `Clock` (so pause and
 *  slow-mo affect them). `Timers.window` (coyote grace), `Timers.buffer` (early
 *  press buffering), `Timers.cooldown` (reuse gate), and `Timers.jumpGate` (the
 *  first two composed into forgiving-jump timing). */
import * as Timers from "./timers.js";
/** WebAudio helpers that own the `AudioContext`, timing and volume. `Audio.sfx`
 *  builds crash-safe sound effects, `Audio.music` schedules a song,
 *  `Audio.bus`/`Audio.master` mix, and `Audio.tone`/`Audio.engine` synthesize.
 *
 *    const sounds = Audio.sfx({
 *      jump: { freq: { from: 300, to: 600 }, ms: 120 },
 *      hit: { noise: true, ms: 80 },
 *    });
 *    sounds.jump.play();
 */
import * as Audio from "./audio/index.js";
/** Small math helpers (named à la Unity so it never shadows `Math`):
 *  interpolation (`Mathf.lerp`, `Mathf.damp`, `Mathf.approach`), ranges
 *  (`Mathf.clamp`, `Mathf.remap`), oscillators (`Mathf.pingPong`, `Mathf.wave`),
 *  plus randomness and 0..1 easing curves. */
import * as Mathf from "./mathf.js";
/** Keyboard/action mapping and device input. `Input.map` binds keys/pad buttons
 *  to named actions with edge state, `Input.gamepad` polls a pad, plus DOM
 *  helpers `Input.wireButton` and `Input.vibrate`.
 *
 *    const input = Input.map({ jump: ["Space", "pad:a"], left: ["ArrowLeft", "KeyA"] });
 *    if (input.jump.pressed) player.vel.y = -JUMP;
 */
import * as Input from "./input/index.js";
/** Crash-safe `localStorage` wrapper: `Storage.load(key, fallback)` and
 *  `Storage.save(key, value)` round-trip any JSON-serializable value and never
 *  throw — private browsing, quota, or corrupt data all fall back silently. */
import * as Storage from "./storage.js";
/** Offscreen pre-rendering and sprite-sheet baking. `Sprites.getSprite`/
 *  `Sprites.getLayer` cache expensive draws, `Sprites.tint` recolors, and
 *  `Sprites.atlas`/`Sprites.packAtlas` build sheets for `Anim.sheet`/`Tiles.grid`
 *  — plus the standard `Sprites.Sprite` ECS component. */
import * as Sprites from "./sprites.js";
/** Dependency-free multiplayer building blocks. `Net.join(url, { room })` opens
 *  a symmetric room; `Net.syncBody`/`syncBodies` handle lightweight or
 *  Physics2D bodies, `syncEntities` handles dynamic collections, and typed
 *  events, ownership, network time, prediction, and diagnostics cover the
 *  common multiplayer loop.
 *
 *    const room = await Net.join("wss://example.com/ws", { room: "demo" });
 *    const ghosts = Net.syncBody(room, player);
 *    for (const g of ghosts) Draw.rect(g.x, g.y, 16, 16, "#888");
 */
import * as Net from "./net/index.js";
/** FPS / frame-time monitoring. `Perf.createPerfTracker` rolls min/max/avg over
 *  a window, `Perf.drawPerfHud` renders an on-canvas overlay, `Perf.plugin`
 *  wires both into the loop, and `Perf.createNetMeter` tracks throughput. */
import * as Perf from "./perf/index.js";
import { Camera } from "./camera/index.js";
/** Neutral game building blocks: `Game.createScoreTracker` persists score/best
 *  and `Game.formatClock` renders `m:ss`. Fitting a fixed logical area into the
 *  viewport lives on `App.init({ resolution })`, not here. */
import * as Game from "./game.js";
/** Pure, dependency-free game recipes (call one, get a value) that recur across
 *  genres: `Goodies.leadTarget`/`Goodies.nearest` (steering), `Goodies.floodFill`/
 *  `Goodies.lineOfSight` (grid), `Goodies.weightedPick`/`Goodies.rollDice`
 *  (random), `Goodies.wrap` (toroidal). Stateful gadgets live in `Gizmos`. */
import * as Goodies from "./goodies/index.js";
/** Stateful game gadgets you create once then tick/mutate (the sibling of
 *  `Goodies`): `Gizmos.combo`, `Gizmos.patrol`, `Gizmos.trail`, `Gizmos.charges`,
 *  `Gizmos.checkpointRoute`, `Gizmos.seedRng`/`Gizmos.shuffleBag`,
 *  `Gizmos.undoStack`, and `Gizmos.car`/`Gizmos.skidmarks`. */
import * as Gizmos from "./gizmos/index.js";
/** ASCII-grid levels as pure data: `Tiles.grid(ascii, { size, legend })` builds
 *  a queryable, `SolidSource` `Level` (feed to `Collision.moveAndSlide`);
 *  `Tiles.set` slices a tileset image into named cells plus `pick`/`anim`/
 *  `auto16` selectors, joined to a level by a `Skin` at `Draw.tiles`.
 *
 *    const level = Tiles.grid("##########\\n#..P.....#\\n##########", {
 *      size: 16,
 *      legend: { "#": { solid: true } },   // unknown chars (P) become spawn markers
 *    });
 *    const start = level.spawnOne("P");
 */
import * as Tiles from "./tiles.js";
/** Cover → swap → reveal scene transitions passed to `Scenes.go`. `Transitions.fade`
 *  and `Transitions.wipe` are ready-made; a `Transition` is plain data, and the
 *  pure fixed-step runner `Transitions.run` fires the swap at full coverage. */
import * as Transitions from "./transitions.js";
/** Opt-in on-screen touch gamepad. `OnscreenInput.gamepad(config)` returns a
 *  `GamepadState` for `Input.map({ pad })` and `OnscreenInput.drawControls(pad)`
 *  renders it — touch and a hardware pad share one code path.
 *  `pad.buttonBounds("a")` locates a semantic canvas button for automation. */
import * as OnscreenInput from "./onscreen.js";

export {
  App,
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
  OnscreenInput,
};
export type {
  Anchor,
  StickSpec,
  ButtonSpec,
  HapticsConfig,
  OnscreenGamepadConfig,
  OnscreenPad,
} from "./onscreen.js";
export type {
  Rect,
  Viewport,
  KeyCode,
  EnginePlugin,
  FrameTimings,
  AppCallbacks,
  AppOptions,
  AppInitOptions,
  DrawTextOptions,
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
export type { SceneSpec, SceneStack, GoOptions, SceneStackOptions } from "./scenes.js";
export type { Component, ComponentInit, Entity, Ecs, System, RenderSystem } from "./ecs/index.js";
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
  StateKit,
  StateCursor,
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
} from "./collision.js";
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
  GamepadNavigation,
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
export type { SpriteCanvas, AtlasOptions, SpriteData } from "./sprites.js";
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
const Collision = {
  rectsOverlap,
  slide,
  moveAndSlide,
  dropThrough,
  slopeY,
  climbLadder,
  grid,
  contacts,
  circleHit,
  crossedDown,
  pointInRect,
  sweptAABB,
  circleRect,
  separateCircles,
  bounceInBounds,
};
// One way in, not three: collision reaches users through the `Collision`
// namespace only. The loose per-function re-exports that used to sit here were
// a duplicate of it (and of the default export's `Collision`), so they bought
// no capability — just more surface to keep honest.
export { Collision };
export { UI };
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
  SelectOption,
  SelectOptions,
  SelectResult,
  Theme,
  ToggleOptions,
} from "./ui/index.js";

export { Vec2 } from "./vec2.js";

export const Minimotor = {
  App,
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
  OnscreenInput,
};

export default Minimotor;
